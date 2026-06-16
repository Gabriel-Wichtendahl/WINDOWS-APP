import React from 'react';
import ReactDOM from 'react-dom';
import {
  DrawTools,
  SmartChart,
  ToolbarWidget,
  setSmartChartsPublicPath
} from '@deriv/deriv-charts';
import '@deriv/deriv-charts/dist/smartcharts.css';
import './styles.css';
import { DerivPublicFeed } from './feed';

setSmartChartsPublicPath('./smartcharts-assets/');
window.isProductionWebsite = false;

const SYMBOLS = [
  { symbol: 'R_10', label: 'Volatility 10' },
  { symbol: 'R_25', label: 'Volatility 25' },
  { symbol: 'R_50', label: 'Volatility 50' },
  { symbol: 'R_75', label: 'Volatility 75' },
  { symbol: 'R_100', label: 'Volatility 100' }
];

function ChartTile({ item, active, focused, feed, connected, onSelect, onFocus }) {
  const toolbar = React.useCallback(
    () => active ? (
      <ToolbarWidget position="top">
        <DrawTools />
      </ToolbarWidget>
    ) : null,
    [active]
  );

  const settings = React.useMemo(() => ({
    theme: 'dark',
    language: 'es',
    lang: 'es',
    countdown: true,
    position: 'left',
    enabledNavigationWidget: true,
    isHighestLowestMarkerEnabled: false,
    whitespace: 80
  }), []);

  return (
    <section
      className={`chartTile ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onMouseDownCapture={() => onSelect(item.symbol)}
    >
      <header className="chartHeader">
        <div>
          <strong>{item.label}</strong>
          <span>{item.symbol}</span>
        </div>
        <div className="chartHeaderActions">
          {active && <span className="activeTag">ACTIVO</span>}
          <button onClick={(event) => { event.stopPropagation(); onFocus(item.symbol); }}>
            {focused ? 'Mosaico' : 'Ampliar'}
          </button>
        </div>
      </header>
      <div className="chartBody">
        <SmartChart
          id={`smartchart-${item.symbol}`}
          symbol={item.symbol}
          chartType="mountain"
          granularity={0}
          settings={settings}
          requestAPI={feed.requestAPI}
          requestSubscribe={feed.requestSubscribe}
          requestForget={feed.requestForget}
          isConnectionOpened={connected}
          shouldFetchTradingTimes
          shouldFetchTickHistory
          isLive
          isAnimationEnabled={false}
          chartControlsWidgets={null}
          topWidgets={() => null}
          bottomWidgets={() => null}
          toolbarWidget={toolbar}
          enabledChartFooter
          enabledNavigationWidget
          crosshairState={null}
          onMessage={(message) => console.warn(item.symbol, message)}
        />
      </div>
    </section>
  );
}

function App() {
  const [connected, setConnected] = React.useState(false);
  const [status, setStatus] = React.useState('Conectando datos…');
  const [activeSymbol, setActiveSymbol] = React.useState('R_10');
  const [focusSymbol, setFocusSymbol] = React.useState(null);
  const [pinned, setPinned] = React.useState(false);
  const feed = React.useMemo(() => new DerivPublicFeed((ok, text) => {
    setConnected(ok);
    setStatus(text);
  }), []);

  React.useEffect(() => () => feed.destroy(), [feed]);
  React.useEffect(() => {
    window.desktopAPI?.getPinned?.().then(setPinned).catch(() => {});
  }, []);

  const togglePin = async () => {
    const next = !pinned;
    const actual = await window.desktopAPI?.setPinned?.(next);
    setPinned(Boolean(actual));
  };

  const toggleFocus = (symbol) => {
    setActiveSymbol(symbol);
    setFocusSymbol((current) => current === symbol ? null : symbol);
  };

  const visibleSymbols = focusSymbol
    ? SYMBOLS.filter((item) => item.symbol === focusSymbol)
    : SYMBOLS;

  return (
    <div className="appShell">
      <header className="appTopbar">
        <div>
          <h1>5 gráficos Deriv — prueba SmartCharts</h1>
          <p className={connected ? 'connected' : 'disconnected'}>{status}</p>
        </div>
        <div className="topActions">
          {focusSymbol && <button onClick={() => setFocusSymbol(null)}>Volver al mosaico</button>}
          <button className={pinned ? 'pinOn' : ''} onClick={togglePin}>📌 Encima: {pinned ? 'ON' : 'OFF'}</button>
        </div>
      </header>

      <main className={`workspace ${focusSymbol ? 'focusMode' : ''}`}>
        <div className="chartsGrid">
          {visibleSymbols.map((item) => (
            <ChartTile
              key={item.symbol}
              item={item}
              active={activeSymbol === item.symbol}
              focused={focusSymbol === item.symbol}
              feed={feed}
              connected={connected}
              onSelect={setActiveSymbol}
              onFocus={toggleFocus}
            />
          ))}
        </div>

        <aside className="sidePanel">
          <h2>Prueba de gráficos</h2>
          <div className="selectedBox">
            <span>Par seleccionado</span>
            <strong>{activeSymbol}</strong>
          </div>
          <p>Las herramientas de dibujo aparecen únicamente en el gráfico activo para no ocupar espacio en los cinco.</p>
          <ol>
            <li>Tocá un gráfico para activarlo.</li>
            <li>Usá el ícono de dibujo dentro del gráfico.</li>
            <li>Dibujá líneas, zonas o Fibonacci.</li>
            <li>Probá “Ampliar” para trabajar cómodo.</li>
          </ol>
          <div className="testNotice">
            Esta compilación es solo para comprobar SmartCharts, el diseño y las herramientas. Todavía no ejecuta operaciones ni reemplaza el panel IC actual.
          </div>
        </aside>
      </main>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));
