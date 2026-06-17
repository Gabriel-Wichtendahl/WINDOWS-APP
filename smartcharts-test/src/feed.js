export const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

export class DerivLiveFeed {
  constructor({ onStatus, onTick }) {
    this.onStatus = onStatus;
    this.onTick = onTick;
    this.endpoints = [
      'wss://api.derivws.com/trading/v1/options/ws/public',
      'wss://red.derivws.com/websockets/v3?app_id=1089&l=ES',
      'wss://ws.derivws.com/websockets/v3?app_id=1089&l=ES',
    ];
    this.endpointIndex = 0;
    this.reqId = 1;
    this.manualClose = false;
    this.multiAttempted = false;
    this.individualMode = false;
    this.seenSymbols = new Set();
    this.connect();
  }

  connect() {
    const endpoint = this.endpoints[this.endpointIndex % this.endpoints.length];
    this.currentEndpoint = endpoint;
    this.onStatus?.(false, 'Conectando datos…');
    this.ws = new WebSocket(endpoint);

    this.ws.addEventListener('open', () => {
      this.multiAttempted = false;
      this.individualMode = false;
      this.seenSymbols.clear();
      this.onStatus?.(true, 'Conectado · esperando primeros ticks');
      this.subscribeAll();

      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ ping: 1, req_id: this.reqId++ }));
        }
      }, 25000);
    });

    this.ws.addEventListener('message', (event) => this.handleMessage(event));

    this.ws.addEventListener('error', () => {
      this.onStatus?.(false, 'Error de conexión de precios');
    });

    this.ws.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      this.onStatus?.(false, 'Reconectando precios…');

      if (!this.manualClose) {
        this.endpointIndex += 1;
        setTimeout(() => this.connect(), 1800);
      }
    });
  }

  send(payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ ...payload, req_id: this.reqId++ }));
    return true;
  }

  subscribeAll() {
    this.multiAttempted = true;
    this.send({ ticks: SYMBOLS, subscribe: 1 });

    // Si el servidor abre la conexión pero no entrega ningún tick de la
    // suscripción múltiple, cambiamos automáticamente a cinco suscripciones
    // dentro de la misma conexión WebSocket.
    clearTimeout(this.multiFallbackTimer);
    this.multiFallbackTimer = setTimeout(() => {
      if (this.seenSymbols.size === 0 && !this.individualMode) {
        this.subscribeIndividually();
      }
    }, 6000);
  }

  subscribeIndividually() {
    if (this.individualMode) return;
    this.individualMode = true;
    this.onStatus?.(true, 'Conectado · activando cinco streams');

    SYMBOLS.forEach((symbol, index) => {
      setTimeout(() => {
        this.send({ ticks: symbol, subscribe: 1 });
      }, index * 180);
    });
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (message.error) {
      const errorText = `${message.error.code || 'Error'}: ${message.error.message || 'Solicitud rechazada'}`;
      const echoTicks = message.echo_req?.ticks;

      if (Array.isArray(echoTicks) && !this.individualMode) {
        this.subscribeIndividually();
        return;
      }

      // No mostramos errores de ping ni mensajes repetidos que no afectan
      // el stream. Los errores de ticks sí quedan visibles.
      if (echoTicks || /tick/i.test(errorText)) {
        this.onStatus?.(false, errorText);
      }
      return;
    }

    const tick = message.tick;
    if (tick) {
      const symbol = tick.symbol || message.echo_req?.ticks;
      const epoch = Number(tick.epoch || tick.time);
      const quote = Number(tick.quote);

      if (SYMBOLS.includes(symbol) && Number.isFinite(epoch) && Number.isFinite(quote)) {
        this.seenSymbols.add(symbol);
        this.onTick?.({ symbol, epoch, quote });

        const received = this.seenSymbols.size;
        this.onStatus?.(
          true,
          received >= SYMBOLS.length
            ? '5 gráficos en vivo'
            : `Recibiendo precios: ${received}/${SYMBOLS.length}`
        );
      }
      return;
    }

    // Algunas versiones pueden enviar un conjunto de ticks en una propiedad
    // plural. Se procesa por compatibilidad sin bloquear la interfaz.
    if (Array.isArray(message.ticks)) {
      message.ticks.forEach((item) => {
        const symbol = item.symbol;
        const epoch = Number(item.epoch || item.time);
        const quote = Number(item.quote);
        if (SYMBOLS.includes(symbol) && Number.isFinite(epoch) && Number.isFinite(quote)) {
          this.seenSymbols.add(symbol);
          this.onTick?.({ symbol, epoch, quote });
        }
      });
    }
  }

  destroy() {
    this.manualClose = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.multiFallbackTimer);
    try {
      this.ws?.close();
    } catch (_) {}
  }
}
