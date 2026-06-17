const TOOL_HINTS = {
  cursor: 'Cursor activo: podés mover y ampliar el gráfico.',
  hline: 'Tocá una vez sobre el precio donde querés la línea horizontal.',
  trend: 'Tocá el punto inicial y después el punto final de la tendencia.',
  rect: 'Tocá dos esquinas para crear una zona rectangular.',
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTime(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Math.floor(new Date(value).getTime() / 1000);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object' && value.year) {
    return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 1000);
  }
  return null;
}

export class DrawingLayer {
  constructor({ container, chart, series, symbol, onHint }) {
    this.container = container;
    this.chart = chart;
    this.series = series;
    this.symbol = symbol;
    this.onHint = onHint;
    this.tool = 'cursor';
    this.drawings = this.load();
    this.firstPoint = null;
    this.hoverPoint = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'drawingCanvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    const timeScale = this.chart.timeScale();
    if (timeScale.subscribeVisibleLogicalRangeChange) {
      timeScale.subscribeVisibleLogicalRangeChange(() => this.scheduleRender());
    }

    this.resize();
    this.setTool('cursor');
  }

  storageKey() {
    return `deriv-drawings:${this.symbol}`;
  }

  load() {
    try {
      const value = JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.drawings));
    } catch (_) {}
  }

  setTool(tool) {
    this.tool = tool;
    this.firstPoint = null;
    this.hoverPoint = null;
    const drawing = tool !== 'cursor';
    this.canvas.style.pointerEvents = drawing ? 'auto' : 'none';
    this.canvas.style.cursor = drawing ? 'crosshair' : 'default';
    this.onHint?.(TOOL_HINTS[tool] || TOOL_HINTS.cursor);
    this.scheduleRender();
  }

  pointFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const time = normalizeTime(this.chart.timeScale().coordinateToTime(x));
    const price = this.series.coordinateToPrice(y);

    if (time === null || price === null || !Number.isFinite(Number(price))) {
      return null;
    }

    return { time: Number(time), price: Number(price), x, y };
  }

  handlePointerDown(event) {
    if (this.tool === 'cursor') return;
    event.preventDefault();
    event.stopPropagation();

    const point = this.pointFromEvent(event);
    if (!point) return;

    if (this.tool === 'hline') {
      this.drawings.push({ id: makeId(), type: 'hline', price: point.price });
      this.save();
      this.scheduleRender();
      return;
    }

    if (!this.firstPoint) {
      this.firstPoint = { time: point.time, price: point.price };
      this.hoverPoint = this.firstPoint;
      this.scheduleRender();
      return;
    }

    this.drawings.push({
      id: makeId(),
      type: this.tool,
      p1: this.firstPoint,
      p2: { time: point.time, price: point.price },
    });
    this.firstPoint = null;
    this.hoverPoint = null;
    this.save();
    this.scheduleRender();
  }

  handlePointerMove(event) {
    if (!this.firstPoint || this.tool === 'cursor' || this.tool === 'hline') return;
    const point = this.pointFromEvent(event);
    if (!point) return;
    this.hoverPoint = { time: point.time, price: point.price };
    this.scheduleRender();
  }

  handlePointerLeave() {
    if (this.firstPoint) {
      this.hoverPoint = this.firstPoint;
      this.scheduleRender();
    }
  }

  undo() {
    if (this.firstPoint) {
      this.firstPoint = null;
      this.hoverPoint = null;
    } else {
      this.drawings.pop();
      this.save();
    }
    this.scheduleRender();
  }

  clear() {
    this.drawings = [];
    this.firstPoint = null;
    this.hoverPoint = null;
    this.save();
    this.scheduleRender();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  coords(point) {
    if (!point) return null;
    const x = this.chart.timeScale().timeToCoordinate(point.time);
    const y = this.series.priceToCoordinate(point.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  renderShape(shape, draft = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = draft ? 1.5 : 2;
    ctx.strokeStyle = draft ? 'rgba(255, 205, 74, 0.85)' : 'rgba(255, 205, 74, 0.95)';
    ctx.fillStyle = 'rgba(255, 205, 74, 0.10)';
    if (draft) ctx.setLineDash([7, 5]);

    if (shape.type === 'hline') {
      const y = this.series.priceToCoordinate(shape.price);
      if (y !== null) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.canvas.clientWidth, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 205, 74, 0.95)';
        ctx.font = '12px system-ui';
        ctx.fillText(Number(shape.price).toFixed(3), 8, Math.max(14, y - 6));
      }
      ctx.restore();
      return;
    }

    const p1 = this.coords(shape.p1);
    const p2 = this.coords(shape.p2);
    if (!p1 || !p2) {
      ctx.restore();
      return;
    }

    if (shape.type === 'trend') {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else if (shape.type === 'rect') {
      const left = Math.min(p1.x, p2.x);
      const top = Math.min(p1.y, p2.y);
      const width = Math.abs(p2.x - p1.x);
      const height = Math.abs(p2.y - p1.y);
      ctx.fillRect(left, top, width, height);
      ctx.strokeRect(left, top, width, height);
    }

    ctx.restore();
  }

  render() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);

    this.drawings.forEach((shape) => this.renderShape(shape));

    if (this.firstPoint && this.hoverPoint && ['trend', 'rect'].includes(this.tool)) {
      this.renderShape(
        {
          type: this.tool,
          p1: this.firstPoint,
          p2: this.hoverPoint,
        },
        true
      );
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.canvas.remove();
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
  }
}
