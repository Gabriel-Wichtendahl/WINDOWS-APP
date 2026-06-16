:root {
  color-scheme: dark;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0d1018;
  color: #f4f6fb;
}
* { box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
button { font: inherit; }
.appShell { height: 100%; display: flex; flex-direction: column; background: #0d1018; }
.appTopbar {
  height: 58px;
  flex: 0 0 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid #2a3040;
  background: #141824;
}
.appTopbar h1 { margin: 0; font-size: 18px; }
.appTopbar p { margin: 2px 0 0; font-size: 12px; }
.connected { color: #35d07f; }
.disconnected { color: #ffbf4a; }
.topActions { display: flex; gap: 8px; }
.topActions button, .chartHeader button {
  color: #e9edf7;
  background: #242a38;
  border: 1px solid #3a4255;
  border-radius: 8px;
  padding: 7px 10px;
  cursor: pointer;
}
.topActions .pinOn { background: #153d2a; border-color: #2b8a58; }
.workspace {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 8px;
  padding: 8px;
}
.chartsGrid {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.chartTile {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #181c25;
  border: 1px solid #2b3243;
  border-radius: 10px;
}
.chartTile:nth-child(5) { grid-column: 1 / span 2; }
.chartTile.active { border-color: #57d79b; box-shadow: 0 0 0 1px rgba(87,215,155,.32); }
.chartHeader {
  height: 37px;
  flex: 0 0 37px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 11px;
  background: #161a23;
  border-bottom: 1px solid #292f3d;
}
.chartHeader strong { font-size: 13px; }
.chartHeader span { margin-left: 7px; color: #858da0; font-size: 10px; }
.chartHeaderActions { display: flex; align-items: center; gap: 6px; }
.chartHeaderActions .activeTag { color: #56daa0; font-weight: 800; font-size: 9px; }
.chartHeader button { padding: 4px 7px; font-size: 10px; }
.chartBody { position: relative; flex: 1; min-height: 0; }
.chartBody > .smartcharts { position: absolute !important; inset: 0; height: 100% !important; }
.sidePanel {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid #2b3243;
  border-radius: 10px;
  background: #151925;
}
.sidePanel h2 { margin: 0 0 12px; font-size: 18px; }
.sidePanel p, .sidePanel li { color: #aeb6c8; font-size: 13px; line-height: 1.45; }
.sidePanel ol { padding-left: 20px; }
.selectedBox { padding: 12px; border-radius: 10px; background: #0f1320; border: 1px solid #30394d; }
.selectedBox span { display: block; font-size: 11px; color: #929bad; }
.selectedBox strong { display: block; margin-top: 4px; font-size: 25px; color: #56daa0; }
.testNotice { margin-top: 18px; padding: 11px; border: 1px solid #745b22; border-radius: 9px; color: #ffd66b; background: #30270f; font-size: 12px; line-height: 1.4; }
.focusMode .chartsGrid { display: block; }
.focusMode .chartTile { width: 100%; height: 100%; }
.focusMode .chartTile:nth-child(5) { grid-column: auto; }

/* Compacta los widgets de SmartCharts para mosaico. */
.chartBody .smartcharts { font-size: 11px; }
.chartBody .cq-top-ui-widgets:empty { display: none; }
.chartBody .sc-toolbar-widget { z-index: 20; }
.chartBody .ciq-chart-area, .chartBody .ciq-chart, .chartBody .chartContainer { height: 100% !important; }

@media (max-width: 1200px) {
  .workspace { grid-template-columns: minmax(0, 1fr) 225px; }
  .sidePanel { padding: 10px; }
}
