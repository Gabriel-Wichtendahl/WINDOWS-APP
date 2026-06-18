import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
} from 'lightweight-charts';
import './styles.css';
import { DerivLiveFeed, SYMBOLS } from './feed';
import { DrawingLayer } from './drawings';
import './trading';

const SYMBOL_META = {
  R_10: { label: 'Volatility 10', precision: 3 },
  R_25: { label: 'Volatility 25', precision: 3 },
  R_50: { label: 'Volatility 50', precision: 3 },
  R_75: { label: 'Volatility 75', precision: 3 },
  R_100: { label: 'Volatility 100', precision: 3 },
};

const MAX_POINTS = 600;
const CACHE_MAX_AGE_MS = 45 * 60 * 1000;
const SAVE_EVERY_MS = 5000;
const LIVE_PAST_SECONDS = 90;
const LIVE_FUTURE_SECONDS = 30;
const MANUAL_VIEW_HOLD_MS = 8000;

const chartsGrid = document.getElementById('chartsGrid');
const workspace = document.getElementById('workspace');
const connectionStatus = document.getElementById('connectionStatus');
const selectedSymbolText = document.getElementById('selectedSymbol');
const pinBtn = document.getElementById('pinBtn');
const backMosaicBtn = document.getElementById('backMosaicBtn');
const drawingHint = document.getElementById('drawingHint');
const undoBtn = document.getElementById('undoBtn');
const clearDrawingsBtn = document.getElementById('clearDrawingsBtn');
const toolButtons = [...document.querySelectorAll('.toolBtn')];
const panelTabButtons = [...document.querySelectorAll('.panelTabBtn')];
const panelPanes = [...document.querySelectorAll('.panelPane')];
const modeToggleBtn = document.getElementById('modeToggleBtn');
const drawingTabBtn = document.getElementById('drawingTabBtn');
const tradeTabBtn = document.getElementById('tradeTabBtn');
const browserSyncCard = document.getElementById('browserSyncCard');
const browserSyncDot = document.getElementById('browserSyncDot');
const browserSyncStatus = document.getElementById('browserSyncStatus');
const browserMarketText = document.getElementById('browserMarketText');
const browserContractText = document.getElementById('browserContractText');
const browserPageText = document.getElementById('browserPageText');
const selectedSymbolLabel = document.getElementById('selectedSymbolLabel');

const chartStates = new Map();
const dataBySymbol = new Map();
const saveTimers = new Map();
let activeSymbol = 'R_10';
let focusSymbol = null;
let selectedTool = 'cursor';
let pinned = false;
let appMode = 'charts';
let latestBrowserState = null;
let removeBrowserStateListener = null;

window.derivBrowserMode = false;
window.derivBrowserState = null;

function isFreshBrowserState(state, maxAgeMs = 4500) {
  return Boolean(
    state?.connected &&
    state?.derivDetected &&
    state?.symbol &&
    Date.now() - Number(state.receivedAt || 0) <= maxAgeMs
  );
}

function contractModeLabel(mode) {
  if (mode === 'higher_lower') return 'Higher / Lower';
  if (mode === 'rise_fall') return 'Rise / Fall';
  return 'No detectado';
}

function applyBrowserState(state) {
  latestBrowserState = state || null;
  window.derivBrowserState = latestBrowserState;

  const fresh = isFreshBrowserState(latestBrowserState);
  browserSyncDot.classList.toggle('connected', fresh);
  browserSyncStatus.textContent = fresh
    ? 'Extensión conectada'
    : latestBrowserState?.connected
      ? 'Lectura desactualizada'
      : 'Esperando extensión…';
  browserMarketText.textContent = latestBrowserState?.symbol || '—';
  browserContractText.textContent = contractModeLabel(latestBrowserState?.contractMode);
  browserPageText.textContent = latestBrowserState?.title || 'Abrí Deriv y seleccioná el mercado.';

  if (appMode === 'browser' && latestBrowserState?.symbol && chartStates.has(latestBrowserState.symbol)) {
    setActiveSymbol(latestBrowserState.symbol);
  }

  window.dispatchEvent(new CustomEvent('browser-state-updated', {
    detail: latestBrowserState || {},
  }));
}

function refreshBrowserFreshness() {
  if (!latestBrowserState) return;
  applyBrowserState(latestBrowserState);
}

async function setAppMode(mode) {
  appMode = mode === 'browser' ? 'browser' : 'charts';
  window.derivBrowserMode = appMode === 'browser';
  document.body.classList.toggle('browserMode', appMode === 'browser');
  browserSyncCard.classList.toggle('hidden', appMode !== 'browser');
  drawingTabBtn.classList.toggle('hidden', appMode === 'browser');
  selectedSymbolLabel.textContent = appMode === 'browser' ? 'Mercado del navegador' : 'Par seleccionado';
  modeToggleBtn.textContent = appMode === 'browser' ? 'Volver a 5 gráficos' : 'Modo navegador';

  if (appMode === 'browser') {
    if (focusSymbol) toggleFocus(focusSymbol);
    showPanel('tradePanel');
    const tradeAuthorized = document.body.classList.contains('tradeAuthorized');
    document.querySelectorAll('.tradeDetails').forEach((details) => {
      details.open = !tradeAuthorized && details.classList.contains('connectionDetails');
    });
    try { await window.electronAPI?.setWindowMode?.('compact'); } catch (_) {}
    try { applyBrowserState(await window.electronAPI?.getBrowserState?.()); } catch (_) {}
  } else {
    showPanel('drawingPanel');
    try { await window.electronAPI?.setWindowMode?.('full'); } catch (_) {}
    setTimeout(() => {
      chartStates.forEach((state) => {
        const rect = state.chartBody.getBoundingClientRect();
        state.chart.applyOptions({ width: rect.width, height: rect.height });
        state.drawingLayer.resize();
        centerLiveWindow(state, true);
        scheduleCurrentPriceDot(state);
      });
    }, 100);
  }
}

function cacheKey(symbol) {
  return `deriv-live-cache:${symbol}`;
}

function loadCachedData(symbol) {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(symbol)) || '{}');
    if (!Array.isArray(parsed.points)) return [];
    if (Date.now() - Number(parsed.savedAt || 0) > CACHE_MAX_AGE_MS) return [];

    const byTime = new Map();
    parsed.points.forEach((point) => {
      const time = Number(point.time);
      const value = Number(point.value);
      if (Number.isFinite(time) && Number.isFinite(value)) {
        byTime.set(time, { time, value });
      }
    });

    return [...byTime.values()]
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_POINTS);
  } catch (_) {
    return [];
  }
}

function scheduleSave(symbol) {
  if (saveTimers.has(symbol)) return;
  const timer = setTimeout(() => {
    saveTimers.delete(symbol);
    try {
      const points = dataBySymbol.get(symbol) || [];
      localStorage.setItem(
        cacheKey(symbol),
        JSON.stringify({ savedAt: Date.now(), points: points.slice(-MAX_POINTS) })
      );
    } catch (_) {}
  }, SAVE_EVERY_MS);
  saveTimers.set(symbol, timer);
}

function estimatePointsPerSecond(points) {
  if (!Array.isArray(points) || points.length < 3) return 1;

  const sample = points.slice(-120);
  const first = sample[0];
  const last = sample[sample.length - 1];
  const spanSeconds = Number(last.time) - Number(first.time);

  if (!Number.isFinite(spanSeconds) || spanSeconds <= 0) return 1;

  const rate = (sample.length - 1) / spanSeconds;
  return Math.min(5, Math.max(0.25, rate));
}

function centerLiveWindow(state, force = false) {
  if (!state) return;
  if (!force && Date.now() < Number(state.manualViewUntil || 0)) return;

  const points = dataBySymbol.get(state.symbol) || [];
  if (!points.length) return;

  const pointsPerSecond = estimatePointsPerSecond(points);
  const pastBars = Math.max(20, Math.round(LIVE_PAST_SECONDS * pointsPerSecond));
  const futureBars = Math.max(8, Math.round(LIVE_FUTURE_SECONDS * pointsPerSecond));
  const lastIndex = points.length - 1;

  state.chart.timeScale().setVisibleLogicalRange({
    from: lastIndex - pastBars,
    to: lastIndex + futureBars,
  });
  state.series.priceScale().applyOptions({ autoScale: true });
  state.drawingLayer.scheduleRender();
}

function pauseLiveFollow(symbol) {
  const state = chartStates.get(symbol);
  if (!state || selectedTool !== 'cursor') return;

  // En modo ampliado, cualquier zoom o desplazamiento manual queda fijo
  // hasta volver al mosaico. En mosaico se conserva la pausa de 8 segundos.
  state.manualViewUntil = focusSymbol === symbol
    ? Number.POSITIVE_INFINITY
    : Date.now() + MANUAL_VIEW_HOLD_MS;
}

function updateCurrentPriceDot(state) {
  if (!state?.currentPriceDot) return;

  const points = dataBySymbol.get(state.symbol) || [];
  const last = points[points.length - 1];

  if (!last) {
    state.currentPriceDot.classList.add('hidden');
    return;
  }

  const x = state.chart.timeScale().timeToCoordinate(last.time);
  const y = state.series.priceToCoordinate(last.value);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    state.currentPriceDot.classList.add('hidden');
    return;
  }

  state.currentPriceDot.style.left = `${x}px`;
  state.currentPriceDot.style.top = `${y}px`;
  state.currentPriceDot.classList.remove('hidden');
}

function scheduleCurrentPriceDot(state) {
  if (!state || state.currentPriceDotFrame) return;

  state.currentPriceDotFrame = requestAnimationFrame(() => {
    state.currentPriceDotFrame = null;
    updateCurrentPriceDot(state);
  });
}

function chartOptions() {
  return {
    layout: {
      background: { type: ColorType.Solid, color: '#10131c' },
      textColor: '#aeb5c6',
      fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(101, 111, 139, 0.13)' },
      horzLines: { color: 'rgba(101, 111, 139, 0.13)' },
    },
    rightPriceScale: {
      borderColor: 'rgba(111, 121, 151, 0.26)',
      scaleMargins: { top: 0.18, bottom: 0.18 },
      minimumWidth: 64,
    },
    timeScale: {
      borderColor: 'rgba(111, 121, 151, 0.26)',
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 0,
      barSpacing: 5,
      minBarSpacing: 0.4,
      fixLeftEdge: false,
      fixRightEdge: false,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: 'rgba(205, 211, 225, 0.45)',
        width: 1,
        style: 2,
        labelBackgroundColor: '#37405a',
      },
      horzLine: {
        color: 'rgba(205, 211, 225, 0.45)',
        width: 1,
        style: 2,
        labelBackgroundColor: '#37405a',
      },
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
    kineticScroll: {
      mouse: true,
      touch: true,
    },
    localization: {
      locale: 'es-AR',
    },
  };
}

function createTile(symbol) {
  const meta = SYMBOL_META[symbol];
  const tile = document.createElement('section');
  tile.className = 'chartTile';
  tile.dataset.symbol = symbol;

  tile.innerHTML = `
    <header class="chartHeader">
      <div class="symbolTitle">
        <strong>${meta.label}</strong>
        <span>${symbol}</span>
      </div>
      <div class="chartStats">
        <span class="liveDot"></span>
        <strong class="lastPrice">—</strong>
        <small class="pointsCount">0 puntos</small>
        <button class="focusBtn">Ampliar</button>
      </div>
    </header>
    <div class="chartBody">
      <div class="emptyState">Esperando primeros ticks…</div>
      <div class="currentPriceDot hidden" aria-hidden="true"></div>
    </div>
  `;

  chartsGrid.appendChild(tile);

  const chartBody = tile.querySelector('.chartBody');
  const emptyState = tile.querySelector('.emptyState');
  const lastPrice = tile.querySelector('.lastPrice');
  const pointsCount = tile.querySelector('.pointsCount');
  const focusBtn = tile.querySelector('.focusBtn');
  const currentPriceDot = tile.querySelector('.currentPriceDot');

  const chart = createChart(chartBody, chartOptions());
  const series = chart.addSeries(LineSeries, {
    color: '#d9dce5',
    lineWidth: 2,
    lineType: 0,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
    crosshairMarkerBorderColor: '#ffffff',
    crosshairMarkerBackgroundColor: '#58627e',
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineColor: 'rgba(217, 220, 229, 0.72)',
    priceLineWidth: 1,
    priceLineStyle: 2,
    priceFormat: {
      type: 'price',
      precision: meta.precision,
      minMove: 10 ** -meta.precision,
    },
  });

  const cached = loadCachedData(symbol);
  dataBySymbol.set(symbol, cached);
  if (cached.length) {
    series.setData(cached);
    const last = cached[cached.length - 1];
    lastPrice.textContent = last.value.toFixed(meta.precision);
    pointsCount.textContent = `${cached.length} puntos`;
    emptyState.classList.add('hidden');
    // La ventana en vivo se centra después de registrar el estado del gráfico.
  }

  const drawingLayer = new DrawingLayer({
    container: chartBody,
    chart,
    series,
    symbol,
    onHint: (text) => {
      if (symbol === activeSymbol) drawingHint.textContent = text;
    },
  });

  const resizeObserver = new ResizeObserver(() => {
    const rect = chartBody.getBoundingClientRect();
    chart.applyOptions({
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    });
    drawingLayer.resize();

    const state = chartStates.get(symbol);
    if (state) {
      const focusedManualView =
        focusSymbol === symbol && state.manualViewUntil === Number.POSITIVE_INFINITY;

      // No pisar el zoom elegido por el usuario mientras está ampliado.
      if (!focusedManualView) centerLiveWindow(state, true);
      scheduleCurrentPriceDot(state);
    }
  });
  resizeObserver.observe(chartBody);

  chartBody.addEventListener('wheel', () => pauseLiveFollow(symbol), { passive: true });

  let dragStart = null;
  chartBody.addEventListener('pointerdown', (event) => {
    if (selectedTool !== 'cursor') return;
    dragStart = { x: event.clientX, y: event.clientY };
  });
  chartBody.addEventListener('pointermove', (event) => {
    if (!dragStart || selectedTool !== 'cursor') return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.hypot(dx, dy) >= 5) {
      pauseLiveFollow(symbol);
      dragStart = null;
    }
  });
  chartBody.addEventListener('pointerup', () => { dragStart = null; });
  chartBody.addEventListener('pointercancel', () => { dragStart = null; });
  chartBody.addEventListener('pointerleave', () => { dragStart = null; });

  const activate = () => setActiveSymbol(symbol);
  tile.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    activate();
  });

  tile.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) return;
    toggleFocus(symbol);
  });

  focusBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFocus(symbol);
  });

  const state = {
    symbol,
    meta,
    tile,
    chartBody,
    emptyState,
    lastPrice,
    pointsCount,
    focusBtn,
    currentPriceDot,
    currentPriceDotFrame: null,
    chart,
    series,
    drawingLayer,
    resizeObserver,
    manualViewUntil: 0,
    visibleRangeHandler: null,
  };

  state.visibleRangeHandler = () => {
    drawingLayer.scheduleRender();
    scheduleCurrentPriceDot(state);
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(state.visibleRangeHandler);
  chartStates.set(symbol, state);

  if (cached.length) {
    setTimeout(() => {
      centerLiveWindow(state, true);
      scheduleCurrentPriceDot(state);
    }, 30);
  }
}

function setConnectionStatus(ok, text) {
  connectionStatus.textContent = text;
  connectionStatus.classList.toggle('connected', Boolean(ok));
  connectionStatus.classList.toggle('disconnected', !ok);
}

function setActiveSymbol(symbol) {
  if (!chartStates.has(symbol)) return;
  activeSymbol = symbol;
  selectedSymbolText.textContent = symbol;

  const tradingSymbolSelect = document.getElementById('symbolSelect');
  if (tradingSymbolSelect) tradingSymbolSelect.value = symbol;
  window.dispatchEvent(new CustomEvent('active-symbol-changed', {
    detail: { symbol },
  }));

  chartStates.forEach((state, key) => {
    const active = key === symbol;
    state.tile.classList.toggle('active', active);
    if (!active) state.drawingLayer.setTool('cursor');
  });

  const activeLayer = chartStates.get(symbol).drawingLayer;
  activeLayer.setTool(selectedTool);
  updateToolButtons();
}

function showPanel(panelId) {
  panelTabButtons.forEach((item) => {
    item.classList.toggle('active', item.dataset.panelTab === panelId);
  });
  panelPanes.forEach((pane) => pane.classList.toggle('hidden', pane.id !== panelId));
}

function updateToolButtons() {
  toolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === selectedTool);
  });
}

function setTool(tool) {
  selectedTool = tool;
  chartStates.forEach((state, symbol) => {
    state.drawingLayer.setTool(symbol === activeSymbol ? tool : 'cursor');
  });
  updateToolButtons();
}

function toggleFocus(symbol) {
  setActiveSymbol(symbol);

  const enteringFocus = focusSymbol !== symbol;
  focusSymbol = enteringFocus ? symbol : null;

  // Al entrar se parte de la ventana centrada. Luego, si el usuario cambia el
  // zoom o desplaza el gráfico, esa vista queda fija. Al volver al mosaico se
  // restaura el seguimiento normal con pausa temporal de 8 segundos.
  if (enteringFocus) {
    const focusedState = chartStates.get(symbol);
    if (focusedState) focusedState.manualViewUntil = 0;
  } else {
    chartStates.forEach((state) => {
      state.manualViewUntil = 0;
    });
  }

  workspace.classList.toggle('focusMode', Boolean(focusSymbol));
  backMosaicBtn.classList.toggle('hidden', !focusSymbol);

  chartStates.forEach((state, key) => {
    const visible = !focusSymbol || key === focusSymbol;
    state.tile.classList.toggle('focusHidden', !visible);
    state.tile.classList.toggle('focused', focusSymbol === key);
    state.focusBtn.textContent = focusSymbol === key ? 'Mosaico' : 'Ampliar';
  });

  setTimeout(() => {
    chartStates.forEach((state, key) => {
      if (!focusSymbol || key === focusSymbol) {
        const rect = state.chartBody.getBoundingClientRect();
        state.chart.applyOptions({ width: rect.width, height: rect.height });
        state.drawingLayer.resize();
        centerLiveWindow(state, true);
        scheduleCurrentPriceDot(state);
      }
    });
  }, 60);
}

function addTick({ symbol, epoch, quote }) {
  const state = chartStates.get(symbol);
  if (!state) return;

  const points = dataBySymbol.get(symbol) || [];
  const point = { time: epoch, value: quote };
  const last = points[points.length - 1];

  if (!last || epoch > last.time) {
    points.push(point);
  } else if (epoch === last.time) {
    points[points.length - 1] = point;
  } else {
    return;
  }

  if (points.length > MAX_POINTS) {
    points.splice(0, points.length - MAX_POINTS);
    state.series.setData(points);
  } else {
    state.series.update(point);
  }

  dataBySymbol.set(symbol, points);
  state.lastPrice.textContent = quote.toFixed(state.meta.precision);
  state.pointsCount.textContent = `${points.length} puntos`;
  state.emptyState.classList.add('hidden');
  state.tile.classList.add('hasData');
  state.drawingLayer.scheduleRender();
  scheduleCurrentPriceDot(state);

  centerLiveWindow(state);
  scheduleSave(symbol);
}

SYMBOLS.forEach(createTile);

setActiveSymbol(activeSymbol);

panelTabButtons.forEach((button) => {
  button.addEventListener('click', () => showPanel(button.dataset.panelTab));
});

modeToggleBtn.addEventListener('click', () => {
  setAppMode(appMode === 'browser' ? 'charts' : 'browser');
});

toolButtons.forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

undoBtn.addEventListener('click', () => {
  chartStates.get(activeSymbol)?.drawingLayer.undo();
});

clearDrawingsBtn.addEventListener('click', () => {
  chartStates.get(activeSymbol)?.drawingLayer.clear();
});

backMosaicBtn.addEventListener('click', () => {
  if (focusSymbol) toggleFocus(focusSymbol);
});

pinBtn.addEventListener('click', async () => {
  try {
    const actual = await window.desktopAPI?.setPinned?.(!pinned);
    pinned = Boolean(actual);
  } catch (_) {
    pinned = false;
  }
  pinBtn.textContent = `📌 Encima: ${pinned ? 'ON' : 'OFF'}`;
  pinBtn.classList.toggle('pinOn', pinned);
});

window.desktopAPI?.getPinned?.().then((value) => {
  pinned = Boolean(value);
  pinBtn.textContent = `📌 Encima: ${pinned ? 'ON' : 'OFF'}`;
  pinBtn.classList.toggle('pinOn', pinned);
}).catch(() => {});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && focusSymbol) {
    toggleFocus(focusSymbol);
    return;
  }

  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && SYMBOLS[index]) {
    setActiveSymbol(SYMBOLS[index]);
  }
});

if (window.electronAPI?.onBrowserState) {
  removeBrowserStateListener = window.electronAPI.onBrowserState(applyBrowserState);
}
window.electronAPI?.getBrowserState?.().then(applyBrowserState).catch(() => {});
setInterval(refreshBrowserFreshness, 1000);

const feed = new DerivLiveFeed({
  onStatus: setConnectionStatus,
  onTick: addTick,
});

window.addEventListener('beforeunload', () => {
  try { removeBrowserStateListener?.(); } catch (_) {}
  feed.destroy();
  chartStates.forEach((state) => {
    state.resizeObserver.disconnect();
    if (state.visibleRangeHandler) {
      state.chart.timeScale().unsubscribeVisibleLogicalRangeChange(state.visibleRangeHandler);
    }
    if (state.currentPriceDotFrame) cancelAnimationFrame(state.currentPriceDotFrame);
    state.drawingLayer.destroy();
    state.chart.remove();
  });
});
