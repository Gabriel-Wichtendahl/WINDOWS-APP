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
    try { message = JSON.parse(event.data); } catch (_) { return; }

    if (message.req_id && this.pending.has(message.req_id)) {
      const pending = this.pending.get(message.req_id);
      clearTimeout(pending.timer);
      this.pending.delete(message.req_id);
      if (message.error) pending.reject(new Error(message.error.message || 'Error Deriv'));
      else pending.resolve(message);
    }

    const subscriptionId = message.subscription?.id;
    if (subscriptionId && this.subscriptionsById.has(subscriptionId)) {
      const callback = this.subscriptionsById.get(subscriptionId);
      try { callback(message); } catch (error) { console.error(error); }
    }
  }

  requestAPI = (request) => this.send(request);

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
      callback({ error: { message: error.message }, echo_req: request });
    }
  };

  requestForget = async (_request, callback) => {
    const subscriptionId = this.subscriptionByCallback.get(callback);
    if (!subscriptionId) return;
    this.subscriptionByCallback.delete(callback);
    this.subscriptionsById.delete(subscriptionId);
    try { await this.send({ forget: subscriptionId }); } catch (_) {}
  };

  destroy() {
    this.manualClose = true;
    clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch (_) {}
  }
}
