const SYNTHETIC_SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10 Index' },
  { symbol: 'R_25', name: 'Volatility 25 Index' },
  { symbol: 'R_50', name: 'Volatility 50 Index' },
  { symbol: 'R_75', name: 'Volatility 75 Index' },
  { symbol: 'R_100', name: 'Volatility 100 Index' }
];

function localServerTime(request = {}) {
  return {
    echo_req: request,
    msg_type: 'time',
    req_id: request.req_id,
    time: Math.floor(Date.now() / 1000)
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
              symbols: SYNTHETIC_SYMBOLS.map(({ symbol, name }) => ({
                symbol,
                name,
                feed_license: 'chartonly',
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
    this.connect();
  }

  connect() {
    this.onStatus?.(false, 'Conectando datos…');
    const url = this.endpoints[this.endpointIndex % this.endpoints.length];
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.onStatus?.(true, 'Datos en vivo');
      this.openWaiters.splice(0).forEach(({ resolve }) => resolve());
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ ping: 1 }));
        }
      }, 25000);
    });

    this.ws.addEventListener('message', (event) => this.handleMessage(event));
    this.ws.addEventListener('error', () => this.onStatus?.(false, 'Error de datos'));
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
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
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

  async send(request, timeoutMs = 15000) {
    await this.waitUntilOpen();
    const reqId = this.reqId++;
    const payload = { ...request, req_id: reqId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('Tiempo de espera agotado'));
      }, timeoutMs);

      this.pending.set(reqId, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (message.req_id && this.pending.has(message.req_id)) {
      const pending = this.pending.get(message.req_id);
      clearTimeout(pending.timer);
      this.pending.delete(message.req_id);

      if (message.error) {
        pending.reject(new Error(message.error.message || 'Error Deriv'));
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

  requestAPI = (request = {}) => {
    // Los cinco índices sintéticos operan de forma continua.
    // SmartCharts quedaba detenido esperando el enorme pedido trading_times.
    // Se responde localmente para que pase directo a ticks_history.
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
      const response = await this.send({ ...request, subscribe: 1 });
      callback(response);

      const subscriptionId = response.subscription?.id;
      if (subscriptionId) {
        this.subscriptionsById.set(subscriptionId, callback);
        this.subscriptionByCallback.set(callback, subscriptionId);
      }
    } catch (error) {
      callback({
        error: { message: error.message },
        echo_req: request
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
