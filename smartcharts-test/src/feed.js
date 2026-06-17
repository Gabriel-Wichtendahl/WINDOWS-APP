const SYNTHETIC_SYMBOLS = [
  { symbol: 'R_10', display_name: 'Volatility 10 Index', pip: 0.001 },
  { symbol: 'R_25', display_name: 'Volatility 25 Index', pip: 0.001 },
  { symbol: 'R_50', display_name: 'Volatility 50 Index', pip: 0.001 },
  { symbol: 'R_75', display_name: 'Volatility 75 Index', pip: 0.001 },
  { symbol: 'R_100', display_name: 'Volatility 100 Index', pip: 0.001 }
];

const HISTORY_COUNT = 200;
const HISTORY_SPACING_MS = 4000;
const HISTORY_CACHE_MS = 120000;
const RATE_LIMIT_RETRY_MS = [8000, 16000, 30000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localServerTime(request = {}) {
  return {
    echo_req: request,
    msg_type: 'time',
    req_id: request.req_id,
    time: Math.floor(Date.now() / 1000)
  };
}

function localActiveSymbols(request = {}) {
  return {
    echo_req: request,
    msg_type: 'active_symbols',
    req_id: request.req_id,
    active_symbols: SYNTHETIC_SYMBOLS.map((item, index) => ({
      allow_forward_starting: 0,
      display_name: item.display_name,
      display_order: index + 1,
      exchange_is_open: 1,
      is_trading_suspended: 0,
      market: 'synthetic_index',
      market_display_name: 'Synthetic Indices',
      pip: item.pip,
      subgroup: 'continuous_indices',
      subgroup_display_name: 'Continuous Indices',
      submarket: 'random_index',
      submarket_display_name: 'Continuous Indices',
      symbol: item.symbol,
      symbol_type: 'stockindex'
    }))
  };
}

function localSyntheticTradingTimes(request = {}) {
  return {
    echo_req: request,
    msg_type: 'trading_times',
    req_id: request.req_id,
    trading_times: {
      markets: [
        {
          name: 'Synthetic Indices',
          submarkets: [
            {
              name: 'Continuous Indices',
              symbols: SYNTHETIC_SYMBOLS.map(({ symbol, display_name }) => ({
                symbol,
                name: display_name,
                feed_license: 'realtime',
                delay_amount: 0,
                events: [],
                times: {
                  open: ['00:00:00'],
                  close: ['23:59:59']
                },
                trading_days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
              }))
            }
          ]
        }
      ]
    }
  };
}

export class DerivPublicFeed {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.endpoints = [
      'wss://api.derivws.com/trading/v1/options/ws/public',
      'wss://red.derivws.com/websockets/v3?app_id=12812&l=ES',
      'wss://ws.derivws.com/websockets/v3?app_id=1089&l=ES'
    ];

    this.endpointIndex = 0;
    this.reqId = 1;
    this.pending = new Map();
    this.subscriptionsById = new Map();
    this.subscriptionByCallback = new Map();
    this.openWaiters = [];
    this.manualClose = false;

    this.historyQueue = Promise.resolve();
    this.historyInFlight = new Map();
    this.memoryHistoryCache = new Map();
    this.lastHistoryRequestAt = 0;
    this.loadedHistorySymbols = new Set();

    this.connect();
  }

  connect() {
    const url = this.endpoints[this.endpointIndex % this.endpoints.length];
    this.onStatus?.(false, 'Conectando datos…');
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      const usingNewPublicApi = url.includes('/trading/v1/options/ws/public');
      this.onStatus?.(
        true,
        usingNewPublicApi
          ? 'Datos en vivo · cargando gráficos de a uno'
          : 'Datos en vivo · respaldo'
      );

      this.openWaiters.splice(0).forEach(({ resolve }) => resolve());
      clearInterval(this.pingTimer);

      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ ping: 1 }));
        }
      }, 25000);
    });

    this.ws.addEventListener('message', (event) => this.handleMessage(event));

    this.ws.addEventListener('error', () => {
      this.onStatus?.(false, 'Error de datos');
    });

    this.ws.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      this.onStatus?.(false, 'Reconectando…');

      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Conexión de mercado cerrada'));
      }

      this.pending.clear();
      this.subscriptionsById.clear();
      this.subscriptionByCallback.clear();

      if (!this.manualClose) {
        this.endpointIndex += 1;
        setTimeout(() => this.connect(), 1800);
      }
    });
  }

  waitUntilOpen(timeoutMs = 12000) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.openWaiters.push(waiter);

      setTimeout(() => {
        const index = this.openWaiters.indexOf(waiter);
        if (index >= 0) this.openWaiters.splice(index, 1);
        reject(new Error('No abrió la conexión de mercado'));
      }, timeoutMs);
    });
  }

  async send(request, timeoutMs = 20000) {
    await this.waitUntilOpen();

    const reqId = this.reqId++;
    const payload = { ...request, req_id: reqId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(
          new Error(
            `Deriv no respondió a ${
              request.ticks_history
                ? 'ticks_history'
                : request.ticks
                  ? 'ticks'
                  : 'la solicitud'
            }`
          )
        );
      }, timeoutMs);

      this.pending.set(reqId, {
        resolve,
        reject,
        timer,
        request,
        createdAt: Date.now()
      });

      this.ws.send(JSON.stringify(payload));
    });
  }

  findPendingForMessage(message) {
    if (message.req_id && this.pending.has(message.req_id)) {
      return message.req_id;
    }

    const echo = message.echo_req || {};

    for (const [reqId, pending] of this.pending.entries()) {
      const request = pending.request || {};

      if (echo.ticks_history && request.ticks_history === echo.ticks_history) {
        return reqId;
      }

      if (echo.ticks && request.ticks === echo.ticks) {
        return reqId;
      }

      if (
        ['history', 'candles'].includes(message.msg_type) &&
        request.ticks_history
      ) {
        return reqId;
      }

      if (message.msg_type === 'tick' && request.ticks) {
        return reqId;
      }
    }

    if (message.error && this.pending.size === 1) {
      return this.pending.keys().next().value;
    }

    return null;
  }

  handleMessage(event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    const pendingReqId = this.findPendingForMessage(message);

    if (pendingReqId && this.pending.has(pendingReqId)) {
      const pending = this.pending.get(pendingReqId);
      clearTimeout(pending.timer);
      this.pending.delete(pendingReqId);

      if (message.error) {
        pending.reject(
          new Error(
            `${message.error.code || 'Error'}: ${
              message.error.message || 'Error Deriv'
            }`
          )
        );
      } else {
        pending.resolve(message);
      }
    }

    const subscriptionId = message.subscription?.id;

    if (subscriptionId && this.subscriptionsById.has(subscriptionId)) {
      const callback = this.subscriptionsById.get(subscriptionId);

      try {
        callback(message);
      } catch (error) {
        console.error(error);
      }
    }
  }

  historyCacheKey(request) {
    return [
      request.ticks_history,
      request.style || 'ticks',
      request.granularity || 0
    ].join('|');
  }

  getStoredHistory(key) {
    const memoryItem = this.memoryHistoryCache.get(key);

    if (memoryItem && Date.now() - memoryItem.savedAt < HISTORY_CACHE_MS) {
      return memoryItem.response;
    }

    try {
      const raw = localStorage.getItem(`smartcharts-history:${key}`);
      if (!raw) return null;

      const parsed = JSON.parse(raw);

      if (Date.now() - parsed.savedAt >= HISTORY_CACHE_MS) {
        localStorage.removeItem(`smartcharts-history:${key}`);
        return null;
      }

      this.memoryHistoryCache.set(key, parsed);
      return parsed.response;
    } catch (_) {
      return null;
    }
  }

  storeHistory(key, response) {
    const item = {
      savedAt: Date.now(),
      response
    };

    this.memoryHistoryCache.set(key, item);

    try {
      localStorage.setItem(`smartcharts-history:${key}`, JSON.stringify(item));
    } catch (_) {}
  }

  isRateLimitError(error) {
    return /rate.?limit|too many requests|limit.*tick.?history/i.test(
      String(error?.message || error || '')
    );
  }

  async waitForHistorySlot() {
    const elapsed = Date.now() - this.lastHistoryRequestAt;
    const remaining = HISTORY_SPACING_MS - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  async requestHistoryWithRetry(request) {
    const symbol = request.ticks_history;
    let lastError;

    for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_MS.length; attempt += 1) {
      await this.waitForHistorySlot();
      this.lastHistoryRequestAt = Date.now();

      try {
        return await this.send(request, 30000);
      } catch (error) {
        lastError = error;

        if (!this.isRateLimitError(error) || attempt >= RATE_LIMIT_RETRY_MS.length) {
          throw error;
        }

        const delayMs = RATE_LIMIT_RETRY_MS[attempt];
        this.onStatus?.(
          true,
          `${symbol}: límite de historial; reintento en ${Math.round(delayMs / 1000)} s`
        );
        await sleep(delayMs);
      }
    }

    throw lastError;
  }

  enqueueHistory(originalRequest) {
    const request = {
      ...originalRequest,
      count: Math.min(Number(originalRequest.count) || HISTORY_COUNT, HISTORY_COUNT),
      end: originalRequest.end || 'latest'
    };

    // En esta llamada queremos solo historial.
    // La API rechaza subscribe: 0 en este endpoint, así que debe omitirse.
    delete request.subscribe;

    const key = this.historyCacheKey(request);
    const cached = this.getStoredHistory(key);

    if (cached) {
      return Promise.resolve(cached);
    }

    if (this.historyInFlight.has(key)) {
      return this.historyInFlight.get(key);
    }

    const task = this.historyQueue
      .catch(() => undefined)
      .then(() => this.requestHistoryWithRetry(request))
      .then((response) => {
        this.storeHistory(key, response);
        return response;
      });

    this.historyQueue = task.catch(() => undefined);
    this.historyInFlight.set(key, task);

    task.finally(() => {
      this.historyInFlight.delete(key);
    });

    return task;
  }

  markHistoryLoaded(symbol) {
    this.loadedHistorySymbols.add(symbol);
    const loaded = this.loadedHistorySymbols.size;

    this.onStatus?.(
      true,
      loaded >= SYNTHETIC_SYMBOLS.length
        ? '5 gráficos en vivo'
        : `Cargando gráficos: ${loaded}/${SYNTHETIC_SYMBOLS.length}`
    );
  }

  requestAPI = (request = {}) => {
    if (request.active_symbols) {
      return Promise.resolve(localActiveSymbols(request));
    }

    if (request.time === 1) {
      return Promise.resolve(localServerTime(request));
    }

    if (request.trading_times) {
      return Promise.resolve(localSyntheticTradingTimes(request));
    }

    return this.send(request);
  };

  requestSubscribe = async (request, callback) => {
    try {
      if (request?.ticks_history) {
        const symbol = request.ticks_history;
        const historyRequest = { ...request };
        delete historyRequest.subscribe;

        const historyResponse = await this.enqueueHistory(historyRequest);
        callback(historyResponse);
        this.markHistoryLoaded(symbol);

        const tickResponse = await this.send(
          {
            ticks: symbol,
            subscribe: 1
          },
          25000
        );

        callback(tickResponse);

        const subscriptionId = tickResponse.subscription?.id;

        if (subscriptionId) {
          this.subscriptionsById.set(subscriptionId, callback);
          this.subscriptionByCallback.set(callback, subscriptionId);
        }

        return;
      }

      const response = await this.send({ ...request, subscribe: 1 }, 25000);
      callback(response);

      const subscriptionId = response.subscription?.id;

      if (subscriptionId) {
        this.subscriptionsById.set(subscriptionId, callback);
        this.subscriptionByCallback.set(callback, subscriptionId);
      }
    } catch (error) {
      this.onStatus?.(false, error.message);

      callback({
        error: {
          code: 'MarketDataError',
          message: error.message
        },
        echo_req: request,
        msg_type: 'error'
      });
    }
  };

  requestForget = async (_request, callback) => {
    const subscriptionId = this.subscriptionByCallback.get(callback);
    if (!subscriptionId) return;

    this.subscriptionByCallback.delete(callback);
    this.subscriptionsById.delete(subscriptionId);

    try {
      await this.send({ forget: subscriptionId });
    } catch (_) {}
  };

  destroy() {
    this.manualClose = true;
    clearInterval(this.pingTimer);

    for (const waiter of this.openWaiters.splice(0)) {
      waiter.reject?.(new Error('Conexión cerrada'));
    }

    try {
      this.ws?.close();
    } catch (_) {}
  }
}
