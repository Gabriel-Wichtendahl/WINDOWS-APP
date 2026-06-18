const $ = (id) => document.getElementById(id);

const els = {
  appIdInput: $('appIdInput'),
  redirectUriInput: $('redirectUriInput'),
  oauthLoginBtn: $('oauthLoginBtn'),
  oauthStatus: $('oauthStatus'),
  accountModeSelect: $('accountModeSelect'),
  accountWarning: $('accountWarning'),
  demoAccountIdInput: $('demoAccountIdInput'),
  realAccountIdInput: $('realAccountIdInput'),
  demoTokenInput: $('demoTokenInput'),
  realTokenInput: $('realTokenInput'),
  accountsBtn: $('accountsBtn'),
  accountsBox: $('accountsBox'),
  connectBtn: $('connectBtn'),
  connectionStatus: $('tradeConnectionStatus'),
  accountText: $('accountText'),
  balanceText: $('balanceText'),
  levelText: $('levelText'),
  stakeText: $('stakeText'),
  lastResultText: $('lastResultText'),
  symbolSelect: $('symbolSelect'),
  manualSymbolWrap: $('manualSymbolWrap'),
  manualSymbolInput: $('manualSymbolInput'),
  modeSelect: $('modeSelect'),
  barrierWrap: $('barrierWrap'),
  targetReturnInput: $('targetReturnInput'),
  barrierEngineStatus: $('barrierEngineStatus'),
  higherPctText: $('higherPctText'),
  higherBarrierText: $('higherBarrierText'),
  lowerPctText: $('lowerPctText'),
  lowerBarrierText: $('lowerBarrierText'),
  durationInput: $('durationInput'),
  durationUnitSelect: $('durationUnitSelect'),
  buyBtn: $('buyBtn'),
  sellBtn: $('sellBtn'),
  tradeReadyHint: $('tradeReadyHint'),
  stepInput: $('stepInput'),
  maxInput: $('maxInput'),
  pctInput: $('pctInput'),
  clearLogBtn: $('clearLogBtn'),
  log: $('log'),
  electronWarning: $('electronWarning')
};

let ws = null;
let reqId = 1;
let pending = new Map();
let isAuthorized = false;
let isSendingOrder = false;
let balance = null;
let currency = 'USD';
let activeAccountId = null;
let activeAccountMode = 'demo';
let balanceSubscriptionId = null;
let contractSubscriptionId = null;
let tickSubscriptionId = null;
let keepAliveTimer = null;
let tradeLog = JSON.parse(localStorage.getItem('tradeLog') || '[]');

let currentSpot = null;
let currentPipSize = null;
let recentQuotes = [];
let availableContractTypes = new Set();
let proposalSubscriptionMeta = new Map();

const barrierEngine = {
  generation: 0,
  running: false,
  calibrating: false,
  timer: null,
  live: { higher: null, lower: null },
  subscriptionIds: { higher: null, lower: null },
  lastCalibrationAt: { higher: 0, lower: 0 },
  lastConfigKey: ''
};

function getElectronApi() {
  return window.electronAPI || null;
}

function hasElectronApi(methodName) {
  const api = getElectronApi();
  if (!api) return false;
  if (!methodName) return true;
  return typeof api[methodName] === 'function';
}

function showElectronMissing(action = 'esta función') {
  const msg = `${action} necesita el ejecutable de Windows/Electron.`;
  if (els.electronWarning) els.electronWarning.classList.remove('hidden');
  addLog(msg, 'err');
  return msg;
}

function updateElectronEnvironmentUi() {
  const ok = hasElectronApi();
  if (els.electronWarning) els.electronWarning.classList.toggle('hidden', ok);
  if (!ok) addLog('El panel de operaciones necesita el ejecutable de Windows.', 'warn');
  return ok;
}

function getSelectedAccountMode() {
  return els.accountModeSelect.value === 'real' ? 'real' : 'demo';
}

function getSelectedToken() {
  return getSelectedAccountMode() === 'real'
    ? String(els.realTokenInput.value || '').trim()
    : String(els.demoTokenInput.value || '').trim();
}

function getSelectedAccountId() {
  return getSelectedAccountMode() === 'real'
    ? String(els.realAccountIdInput.value || '').trim()
    : String(els.demoAccountIdInput.value || '').trim();
}

function getAccountLabel(mode = getSelectedAccountMode()) {
  return mode === 'real' ? 'REAL' : 'DEMO';
}

function getSymbol() {
  if (window.derivBrowserMode && window.derivBrowserState?.symbol) {
    return String(window.derivBrowserState.symbol).trim();
  }
  const active = String(document.getElementById('selectedSymbol')?.textContent || '').trim();
  return active || String(els.symbolSelect?.value || 'R_10').trim();
}

function browserStateIsFresh(state, maxAgeMs = 4500) {
  return Boolean(
    state?.connected &&
    state?.derivDetected &&
    state?.symbol &&
    Date.now() - Number(state.receivedAt || 0) <= maxAgeMs
  );
}

function applyBrowserStateToTrading(state, restart = false) {
  if (!state) return;
  window.derivBrowserState = state;

  if (state.symbol && els.symbolSelect) {
    els.symbolSelect.value = state.symbol;
  }

  // Solo cambiamos automáticamente Rise/Fall o Higher/Lower cuando la
  // extensión identificó una pestaña/control activo con suficiente confianza.
  // Así evitamos que texto oculto de Higher/Lower pise Rise/Fall.
  const confidence = Number(state.contractConfidence || 0);
  if (
    state.contractMode &&
    confidence >= 3 &&
    els.modeSelect.value !== state.contractMode
  ) {
    els.modeSelect.value = state.contractMode;
    saveSettings();
    updateUi();
    if (restart && isAuthorized) scheduleMarketRestart('cambió el contrato detectado en Deriv');
  }
}

async function readBrowserStateForOrder() {
  if (!window.derivBrowserMode) return null;
  if (!hasElectronApi('getBrowserState')) {
    throw new Error('No está disponible la lectura de la extensión.');
  }

  const state = await getElectronApi().getBrowserState();
  applyBrowserStateToTrading(state, true);

  if (!browserStateIsFresh(state)) {
    throw new Error('No se detectó una pestaña activa de Deriv. Abrí Deriv y verificá la extensión.');
  }

  addLog(
    `Lectura navegador: ${state.symbol} · ${state.contractMode === 'higher_lower' ? 'Higher/Lower' : 'Rise/Fall'}`,
    'warn'
  );
  return state;
}

function getTargetReturn() {
  const value = Number(els.targetReturnInput.value || 120);
  return Number.isFinite(value) && value > 0 ? value : 120;
}

function saveSettings() {
  localStorage.setItem('derivIcSettings', JSON.stringify({
    appId: els.appIdInput.value,
    redirectUri: els.redirectUriInput.value,
    accountMode: els.accountModeSelect.value,
    demoAccountId: els.demoAccountIdInput.value,
    realAccountId: els.realAccountIdInput.value,
    demoToken: els.demoTokenInput.value,
    realToken: els.realTokenInput.value,
    mode: els.modeSelect.value,
    targetReturn: els.targetReturnInput.value,
    duration: els.durationInput.value,
    unit: els.durationUnitSelect.value,
    step: els.stepInput.value,
    max: els.maxInput.value,
    pct: els.pctInput.value
  }));
}

function loadSettings() {
  const raw = localStorage.getItem('derivIcSettings');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (s.appId) els.appIdInput.value = s.appId;
    if (s.redirectUri) els.redirectUriInput.value = s.redirectUri;
    if (s.accountMode) els.accountModeSelect.value = s.accountMode;
    if (s.demoAccountId) els.demoAccountIdInput.value = s.demoAccountId;
    if (s.realAccountId) els.realAccountIdInput.value = s.realAccountId;
    if (s.demoToken) els.demoTokenInput.value = s.demoToken;
    else if (s.token) els.demoTokenInput.value = s.token;
    if (s.realToken) els.realTokenInput.value = s.realToken;
    if (s.mode) els.modeSelect.value = s.mode;
    if (s.targetReturn) els.targetReturnInput.value = s.targetReturn;
    if (s.duration) els.durationInput.value = s.duration;
    if (s.unit) els.durationUnitSelect.value = s.unit;
    if (s.step) els.stepInput.value = s.step;
    if (s.max) els.maxInput.value = s.max;
    if (s.pct) els.pctInput.value = s.pct;
  } catch (_) {}
}

function setStatus(text, cls = '') {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = cls;
}

function addLog(message, cls = '') {
  const item = {
    at: new Date().toLocaleTimeString(),
    message,
    cls
  };
  tradeLog.unshift(item);
  tradeLog = tradeLog.slice(0, 100);
  localStorage.setItem('tradeLog', JSON.stringify(tradeLog));
  renderLog();
}

function renderLog() {
  els.log.innerHTML = tradeLog.map(item => (
    `<div class="logItem ${item.cls}"><b>${item.at}</b> · ${escapeHtml(item.message)}</div>`
  )).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function send(payload, timeoutMs = 15000) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('WebSocket no conectado'));
  }
  const id = reqId++;
  const request = { ...payload, req_id: id };
  ws.send(JSON.stringify(request));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Timeout de respuesta Deriv'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
  });
}

async function oauthLogin() {
  saveSettings();
  const clientId = String(els.appIdInput.value || '').trim();
  const redirectUri = String(els.redirectUriInput.value || '').trim();

  if (!clientId || !redirectUri) {
    addLog('Falta Client ID/App ID o Redirect URL para OAuth.', 'err');
    return;
  }

  els.oauthLoginBtn.disabled = true;
  els.oauthStatus.textContent = 'Abriendo login de Deriv...';
  addLog('Iniciando login OAuth con Deriv...', 'warn');

  try {
    if (!hasElectronApi('oauthLogin')) {
      showElectronMissing('OAuth/Login Deriv');
      return;
    }
    const tokenData = await getElectronApi().oauthLogin({ clientId, redirectUri });
    const accessToken = tokenData.access_token;
    const expiresIn = Number(tokenData.expires_in || 0);
    if (!accessToken) throw new Error('No se recibió access_token.');

    els.demoTokenInput.value = accessToken;
    els.realTokenInput.value = accessToken;
    saveSettings();
    els.oauthStatus.textContent = expiresIn
      ? `Login correcto. Token cargado. Expira aprox. en ${Math.round(expiresIn / 60)} min.`
      : 'Login correcto. Token cargado.';
    addLog('OAuth correcto. Ahora buscá y elegí la cuenta.', 'ok');
    await listOptionsAccounts();
  } catch (err) {
    els.oauthStatus.textContent = `Error OAuth: ${err.message}`;
    addLog(`Error OAuth: ${err.message}`, 'err');
  } finally {
    els.oauthLoginBtn.disabled = false;
  }
}

async function connect() {
  saveSettings();
  const appId = String(els.appIdInput.value || '').trim();
  const token = getSelectedToken();
  const accountId = getSelectedAccountId();
  const requestedMode = getSelectedAccountMode();
  const requestedLabel = getAccountLabel(requestedMode);

  if (!appId || !token || !accountId) {
    addLog(`Falta App ID, token o Account ID ${requestedLabel}.`, 'err');
    return;
  }

  disconnect();
  activeAccountMode = requestedMode;
  activeAccountId = accountId;
  setStatus(`Pidiendo OTP ${requestedLabel}...`, 'warn');
  els.connectBtn.disabled = true;

  try {
    if (!hasElectronApi('getOtpWebSocketUrl')) {
      showElectronMissing('Conectar con API nueva');
      throw new Error('Electron API no disponible');
    }
    const wsUrl = await getElectronApi().getOtpWebSocketUrl({ appId, token, accountId });
    const urlMode = String(wsUrl).includes('/ws/real') ? 'real' : String(wsUrl).includes('/ws/demo') ? 'demo' : requestedMode;
    activeAccountMode = urlMode;

    setStatus(`Conectando WebSocket ${getAccountLabel(activeAccountMode)}...`, 'warn');
    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      try {
        isAuthorized = true;
        setStatus(`Conectado ${getAccountLabel(activeAccountMode)}: ${activeAccountId}`, activeAccountMode === 'real' ? 'realStatus' : 'ok');
        addLog(`Conectado API nueva ${getAccountLabel(activeAccountMode)} · ${activeAccountId}.`, activeAccountMode === 'real' ? 'warn' : 'ok');
        startKeepAlive();
        await subscribeBalance();
        await restartMarketEngine('conexión');
      } catch (err) {
        addLog(`Conectó, pero falló la preparación: ${err.message}`, 'err');
      } finally {
        els.connectBtn.disabled = false;
        updateUi();
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (msg.error && msg.req_id && pending.has(msg.req_id)) {
        const { reject, timeout } = pending.get(msg.req_id);
        clearTimeout(timeout);
        pending.delete(msg.req_id);
        reject(new Error(msg.error.message || 'Error Deriv'));
        return;
      }

      if (msg.req_id && pending.has(msg.req_id)) {
        const { resolve, timeout } = pending.get(msg.req_id);
        clearTimeout(timeout);
        pending.delete(msg.req_id);
        resolve(msg);
        return;
      }

      if (msg.error) {
        addLog(`Error Deriv: ${msg.error.message || JSON.stringify(msg.error)}`, 'err');
        return;
      }

      if (msg.msg_type === 'balance' && msg.balance) {
        const previousStake = getStake();
        balance = Number(msg.balance.balance);
        currency = msg.balance.currency || currency;
        if (msg.subscription?.id) balanceSubscriptionId = msg.subscription.id;
        updateUi();
        if (Math.abs(previousStake - getStake()) >= 0.01) scheduleMarketRestart('cambió el stake IC');
        return;
      }

      if (msg.msg_type === 'tick' && msg.tick) {
        handleTick(msg.tick, msg.subscription?.id);
        return;
      }

      if (msg.msg_type === 'proposal' && msg.proposal) {
        handleProposalStream(msg);
        return;
      }

      if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
        handleContractUpdate(msg.proposal_open_contract, msg.subscription?.id);
      }
    };

    ws.onerror = () => {
      addLog('Error de conexión WebSocket.', 'err');
      setStatus('Error de conexión', 'err');
    };

    ws.onclose = () => {
      isAuthorized = false;
      isSendingOrder = false;
      activeAccountId = null;
      setStatus('Desconectado');
      els.connectBtn.disabled = false;
      stopBarrierEngine();
      stopKeepAlive();
      updateUi();
    };
  } catch (err) {
    addLog(`Error API nueva ${requestedLabel}: ${err.message}`, 'err');
    setStatus('Error API nueva', 'err');
    disconnect();
    els.connectBtn.disabled = false;
    updateUi();
  }
}

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ping: 1 }));
    }
  }, 30000);
}

function stopKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

function disconnect() {
  stopKeepAlive();
  stopBarrierEngine();
  if (ws) {
    try { ws.close(); } catch (_) {}
  }
  ws = null;
  isAuthorized = false;
  isSendingOrder = false;
  activeAccountId = null;
  balance = null;
  balanceSubscriptionId = null;
  contractSubscriptionId = null;
  tickSubscriptionId = null;
  pending.forEach(({ timeout, reject }) => {
    clearTimeout(timeout);
    reject(new Error('Conexión cerrada'));
  });
  pending.clear();
}

async function subscribeBalance() {
  const res = await send({ balance: 1, subscribe: 1 });
  if (res.balance) {
    balance = Number(res.balance.balance);
    currency = res.balance.currency || currency;
  }
  if (res.subscription?.id) balanceSubscriptionId = res.subscription.id;
  updateUi();
}

function getIcConfig() {
  return {
    step: Number(els.stepInput.value || 105),
    max: Number(els.maxInput.value || 2000),
    pct: Number(els.pctInput.value || 5) / 100
  };
}

function getLevelForBalance(value) {
  const { step, max } = getIcConfig();
  if (!Number.isFinite(value) || value <= 0) return step;
  if (value >= max) return max;
  const level = Math.floor(value / step) * step;
  return Math.max(step, level || step);
}

function getStake() {
  const { pct } = getIcConfig();
  const level = getLevelForBalance(balance ?? 0);
  return Number((level * pct).toFixed(2));
}

function updateAccountModeUi() {
  const selectedMode = getSelectedAccountMode();
  const selectedLabel = getAccountLabel(selectedMode);
  els.connectBtn.textContent = `Conectar ${selectedLabel}`;
  els.accountWarning.classList.toggle('realHint', selectedMode === 'real');
  els.accountWarning.classList.toggle('demoHint', selectedMode !== 'real');
  els.accountWarning.textContent = selectedMode === 'real'
    ? 'ATENCIÓN: modo REAL seleccionado. Las operaciones usan saldo real.'
    : 'Modo demo activo. Ideal para testear sin tocar saldo real.';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Calculando…';
}

function updateBarrierUi() {
  const higher = barrierEngine.live.higher;
  const lower = barrierEngine.live.lower;
  els.higherPctText.textContent = higher ? formatPercent(higher.returnPct) : 'Calculando…';
  els.higherBarrierText.textContent = higher ? `Barrera ${higher.barrier}` : 'Buscando barrera';
  els.lowerPctText.textContent = lower ? formatPercent(lower.returnPct) : 'Calculando…';
  els.lowerBarrierText.textContent = lower ? `Barrera ${lower.barrier}` : 'Buscando barrera';

  if (!isAuthorized) {
    els.barrierEngineStatus.textContent = 'Conectá una cuenta para iniciar el cálculo automático.';
  } else if (els.modeSelect.value !== 'higher_lower') {
    els.barrierEngineStatus.textContent = 'El cálculo automático se activa en Higher/Lower.';
  } else if (barrierEngine.calibrating) {
    els.barrierEngineStatus.textContent = `Calculando barreras cercanas a ${getTargetReturn().toFixed(0)}%…`;
  } else if (higher && lower) {
    els.barrierEngineStatus.textContent = 'Listo: las dos propuestas se actualizan en vivo. Al tocar, se refresca y se compra la más cercana.';
  } else {
    els.barrierEngineStatus.textContent = 'Preparando propuestas Higher y Lower…';
  }
}

function updateUi() {
  updateAccountModeUi();
  const level = getLevelForBalance(balance ?? 0);
  const stake = getStake();

  els.accountText.textContent = isAuthorized
    ? `${getAccountLabel(activeAccountMode)} ${activeAccountId || ''}`.trim()
    : getAccountLabel(getSelectedAccountMode());
  els.accountText.className = isAuthorized && activeAccountMode === 'real' ? 'realAccount' : '';
  els.balanceText.textContent = balance === null ? '—' : `${balance.toFixed(2)} ${currency}`;
  els.levelText.textContent = balance === null ? '—' : `${level}`;
  els.stakeText.textContent = balance === null ? '—' : `${stake.toFixed(2)} ${currency}`;

  const browserReady = !window.derivBrowserMode || browserStateIsFresh(window.derivBrowserState);
  const canTrade = isAuthorized && !isSendingOrder && balance !== null && browserReady;
  els.buyBtn.disabled = !canTrade;
  els.sellBtn.disabled = !canTrade;

  document.body.classList.toggle('tradeAuthorized', isAuthorized && balance !== null);
  document.body.classList.toggle('tradeReady', canTrade);

  if (els.tradeReadyHint) {
    if (!isAuthorized) {
      els.tradeReadyHint.textContent = 'Conectá una cuenta DEMO o REAL para habilitar Compra y Venta.';
      els.tradeReadyHint.className = 'tradeReadyHint warn';
    } else if (balance === null) {
      els.tradeReadyHint.textContent = 'Cuenta conectada. Esperando el saldo de Deriv…';
      els.tradeReadyHint.className = 'tradeReadyHint warn';
    } else if (!browserReady) {
      els.tradeReadyHint.textContent = 'Esperando una lectura actual de la pestaña activa de Deriv.';
      els.tradeReadyHint.className = 'tradeReadyHint warn';
    } else if (isSendingOrder) {
      els.tradeReadyHint.textContent = 'Enviando la orden a Deriv…';
      els.tradeReadyHint.className = 'tradeReadyHint warn';
    } else {
      els.tradeReadyHint.textContent = `${getSymbol()} listo para operar en ${getAccountLabel(activeAccountMode)}.`;
      els.tradeReadyHint.className = 'tradeReadyHint ready';
    }
  }

  const mode = els.modeSelect.value;
  els.barrierWrap.classList.toggle('hidden', mode !== 'higher_lower');

  if (mode === 'higher_lower') {
    const higher = barrierEngine.live.higher;
    const lower = barrierEngine.live.lower;
    els.buyBtn.innerHTML = `HIGHER<br><span>${higher ? `${formatPercent(higher.returnPct)} · ${higher.barrier}` : 'calculando barrera'}</span>`;
    els.sellBtn.innerHTML = `LOWER<br><span>${lower ? `${formatPercent(lower.returnPct)} · ${lower.barrier}` : 'calculando barrera'}</span>`;
  } else {
    els.buyBtn.innerHTML = 'COMPRA<br><span>CALL / RISE</span>';
    els.sellBtn.innerHTML = 'VENTA<br><span>PUT / FALL</span>';
  }
  updateBarrierUi();
}

function normalizePipValue(rawPipSize, quote) {
  const n = Number(rawPipSize);
  if (Number.isFinite(n)) {
    if (Number.isInteger(n) && n >= 0 && n <= 12) return 10 ** (-n);
    if (n > 0 && n < 1) return n;
  }
  const text = String(quote ?? '');
  const decimals = text.includes('.') ? Math.min(8, text.split('.')[1].length) : 2;
  return 10 ** (-Math.max(0, decimals));
}

function handleTick(tick, subId) {
  if (subId) tickSubscriptionId = subId;
  const quote = Number(tick.quote);
  if (!Number.isFinite(quote)) return;
  currentSpot = quote;
  if (tick.pip_size !== undefined && tick.pip_size !== null) currentPipSize = tick.pip_size;
  recentQuotes.push(quote);
  if (recentQuotes.length > 80) recentQuotes.shift();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function estimateBaseDistance() {
  const pip = normalizePipValue(currentPipSize, currentSpot);
  const diffs = [];
  for (let i = 1; i < recentQuotes.length; i += 1) {
    const d = Math.abs(recentQuotes[i] - recentQuotes[i - 1]);
    if (d > 0 && Number.isFinite(d)) diffs.push(d);
  }
  const typicalMove = median(diffs);
  const duration = Math.max(1, Number(els.durationInput.value || 1));
  const unit = els.durationUnitSelect.value;
  const durationFactor = unit === 't'
    ? Math.sqrt(duration)
    : unit === 's'
      ? Math.sqrt(Math.max(1, duration / 5))
      : Math.sqrt(Math.max(1, duration * 12));
  return Math.max(pip, typicalMove || pip * 10) * Math.max(1, durationFactor * 0.6);
}

function getDistanceDecimals() {
  const pip = normalizePipValue(currentPipSize, currentSpot);
  if (!Number.isFinite(pip) || pip <= 0) return 6;
  const decimals = Math.max(0, Math.ceil(-Math.log10(pip)));
  return Math.min(12, Math.max(2, decimals));
}

function formatRelativeBarrier(side, distance) {
  const pip = normalizePipValue(currentPipSize, currentSpot);
  const safe = Math.max(pip, Math.abs(Number(distance) || pip));
  const decimals = getDistanceDecimals();
  let text = safe.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
  if (!text || Number(text) === 0) text = pip.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
  return `${side === 'higher' ? '+' : '-'}${text}`;
}

function getContractType(side) {
  if (side === 'higher') {
    if (availableContractTypes.has('HIGHER')) return 'HIGHER';
    return 'CALL';
  }
  if (availableContractTypes.has('LOWER')) return 'LOWER';
  return 'PUT';
}

function buildProposalRequest(side, barrier, subscribe = false) {
  return {
    proposal: 1,
    amount: getStake(),
    basis: 'stake',
    contract_type: getContractType(side),
    currency,
    duration: Math.max(1, Number(els.durationInput.value || 1)),
    duration_unit: els.durationUnitSelect.value,
    underlying_symbol: getSymbol(),
    barrier,
    ...(subscribe ? { subscribe: 1 } : {})
  };
}

function proposalToQuote(side, msg, fallbackBarrier) {
  const proposal = msg?.proposal;
  if (!proposal?.id) return null;
  const askPrice = Number(proposal.ask_price);
  const payout = Number(proposal.payout);
  if (!Number.isFinite(askPrice) || askPrice <= 0 || !Number.isFinite(payout)) return null;
  const returnPct = ((payout - askPrice) / askPrice) * 100;
  const barrier = String(msg?.echo_req?.barrier || fallbackBarrier || '');
  return {
    side,
    id: proposal.id,
    askPrice,
    payout,
    returnPct,
    barrier,
    distance: Math.abs(Number(barrier)),
    updatedAt: Date.now(),
    subscriptionId: msg?.subscription?.id || null
  };
}

async function requestBarrierQuote(side, distance, subscribe = false) {
  const barrier = formatRelativeBarrier(side, distance);
  const msg = await send(buildProposalRequest(side, barrier, subscribe), 12000);
  const quote = proposalToQuote(side, msg, barrier);
  if (!quote) throw new Error('Propuesta sin precio/payout válido');
  return { quote, msg };
}

function chooseBetter(current, candidate, target) {
  if (!candidate) return current;
  if (!current) return candidate;
  return Math.abs(candidate.returnPct - target) < Math.abs(current.returnPct - target) ? candidate : current;
}

async function findBestBarrier(side, generation, quick = false) {
  const target = getTargetReturn();
  const pip = normalizePipValue(currentPipSize, currentSpot);
  const previous = barrierEngine.live[side];
  let distance = previous?.distance || estimateBaseDistance();
  distance = Math.max(pip, distance);
  let best = null;
  let low = null;
  let high = null;
  const maxExpand = quick ? 4 : 8;

  const sample = async (d) => {
    if (generation !== barrierEngine.generation) throw new Error('Cálculo reemplazado');
    try {
      const { quote } = await requestBarrierQuote(side, Math.max(pip, d), false);
      best = chooseBetter(best, quote, target);
      await sleep(80);
      return quote;
    } catch (_) {
      await sleep(80);
      return null;
    }
  };

  let first = await sample(distance);
  if (!first) {
    const fallbacks = [pip, pip * 10, pip * 100, pip * 1000, Math.max(pip, Math.abs(currentSpot || 1) * 0.0001)];
    for (const d of fallbacks) {
      first = await sample(d);
      if (first) {
        distance = d;
        break;
      }
    }
  }
  if (!first) throw new Error(`Deriv no devolvió propuestas ${side.toUpperCase()}`);

  if (first.returnPct < target) {
    low = first;
    let d = distance;
    for (let i = 0; i < maxExpand; i += 1) {
      d *= 2;
      const q = await sample(d);
      if (!q) continue;
      if (q.returnPct >= target) {
        high = q;
        break;
      }
      low = q;
    }
  } else {
    high = first;
    let d = distance;
    for (let i = 0; i < maxExpand; i += 1) {
      d = Math.max(pip, d / 2);
      const q = await sample(d);
      if (!q) continue;
      if (q.returnPct <= target || d <= pip * 1.0001) {
        low = q;
        break;
      }
      high = q;
    }
  }

  if (low && high && low.distance > 0 && high.distance > 0) {
    let lo = Math.min(low.distance, high.distance);
    let hi = Math.max(low.distance, high.distance);
    const refineCount = quick ? 3 : 6;
    for (let i = 0; i < refineCount; i += 1) {
      const mid = (lo + hi) / 2;
      const q = await sample(mid);
      if (!q) continue;
      if (q.returnPct < target) lo = q.distance;
      else hi = q.distance;
    }
  } else if (!quick) {
    const base = best?.distance || distance;
    for (const factor of [0.7, 0.85, 1.15, 1.35]) {
      await sample(Math.max(pip, base * factor));
    }
  }

  if (!best) throw new Error(`No se encontró propuesta ${side.toUpperCase()}`);
  return best;
}

async function forgetSubscription(id) {
  if (!id || !ws || ws.readyState !== WebSocket.OPEN) return;
  proposalSubscriptionMeta.delete(id);
  try { await send({ forget: id }, 6000); } catch (_) {}
}

async function startLiveBarrierSubscription(side, best, generation) {
  if (generation !== barrierEngine.generation) return;
  const oldId = barrierEngine.subscriptionIds[side];
  if (oldId) await forgetSubscription(oldId);

  const { quote, msg } = await requestBarrierQuote(side, best.distance, true);
  if (generation !== barrierEngine.generation) {
    if (msg.subscription?.id) await forgetSubscription(msg.subscription.id);
    return;
  }

  const subId = msg.subscription?.id || quote.subscriptionId;
  if (subId) {
    barrierEngine.subscriptionIds[side] = subId;
    proposalSubscriptionMeta.set(subId, { side, barrier: quote.barrier, generation });
  }
  barrierEngine.live[side] = quote;
  barrierEngine.lastCalibrationAt[side] = Date.now();
  updateUi();
}

function handleProposalStream(msg) {
  const subId = msg.subscription?.id;
  if (!subId) return;
  const meta = proposalSubscriptionMeta.get(subId);
  if (!meta || meta.generation !== barrierEngine.generation) return;
  const quote = proposalToQuote(meta.side, msg, meta.barrier);
  if (!quote) return;
  barrierEngine.live[meta.side] = quote;
  updateUi();
}

async function loadMarketMetadata(symbol) {
  try {
    const active = await send({ active_symbols: 'brief' });
    const list = active.active_symbols || [];
    const item = list.find(x => (x.underlying_symbol || x.symbol) === symbol);
    if (item?.pip_size !== undefined) currentPipSize = item.pip_size;
  } catch (_) {}

  try {
    const contracts = await send({ contracts_for: symbol });
    const available = contracts.contracts_for?.available || [];
    availableContractTypes = new Set(available.map(c => c.contract_type).filter(Boolean));
  } catch (_) {
    availableContractTypes = new Set();
  }
}

async function subscribeTicks(symbol) {
  if (tickSubscriptionId) {
    try { await send({ forget: tickSubscriptionId }, 6000); } catch (_) {}
    tickSubscriptionId = null;
  }
  recentQuotes = [];
  currentSpot = null;
  const res = await send({ ticks: symbol, subscribe: 1 });
  if (res.tick) handleTick(res.tick, res.subscription?.id);
  if (res.subscription?.id) tickSubscriptionId = res.subscription.id;
}

function configKey() {
  return [
    getSymbol(),
    els.modeSelect.value,
    els.durationInput.value,
    els.durationUnitSelect.value,
    getStake().toFixed(2),
    getTargetReturn().toFixed(2),
    currency
  ].join('|');
}

async function calibrateSide(side, generation, quick = false) {
  const best = await findBestBarrier(side, generation, quick);
  await startLiveBarrierSubscription(side, best, generation);
  addLog(`${side.toUpperCase()} listo: ${best.returnPct.toFixed(1)}% · barrera ${best.barrier}`, 'ok');
  return best;
}

async function startBarrierEngine(reason = 'configuración') {
  if (!isAuthorized || els.modeSelect.value !== 'higher_lower') return;
  const symbol = getSymbol();
  if (!symbol) return;

  const generation = ++barrierEngine.generation;
  barrierEngine.running = true;
  barrierEngine.calibrating = true;
  barrierEngine.lastConfigKey = configKey();
  barrierEngine.live = { higher: null, lower: null };
  updateUi();
  addLog(`Auto-barrera: recalculando por ${reason}. Objetivo ${getTargetReturn().toFixed(0)}%.`, 'warn');

  try {
    await stopProposalSubscriptionsOnly();
    await loadMarketMetadata(symbol);
    await subscribeTicks(symbol);
    await sleep(450);
    if (generation !== barrierEngine.generation) return;

    for (const side of ['higher', 'lower']) {
      if (generation !== barrierEngine.generation) return;
      try {
        await calibrateSide(side, generation, false);
      } catch (err) {
        addLog(`${side.toUpperCase()}: ${err.message || 'no se pudo calcular'}`, 'err');
      }
    }
  } finally {
    if (generation === barrierEngine.generation) {
      barrierEngine.calibrating = false;
      updateUi();
      startRetuneLoop();
    }
  }
}

async function stopProposalSubscriptionsOnly() {
  const ids = Object.values(barrierEngine.subscriptionIds).filter(Boolean);
  barrierEngine.subscriptionIds = { higher: null, lower: null };
  proposalSubscriptionMeta.clear();
  for (const id of ids) await forgetSubscription(id);
}

function startRetuneLoop() {
  if (barrierEngine.timer) clearInterval(barrierEngine.timer);
  barrierEngine.timer = setInterval(async () => {
    if (!isAuthorized || els.modeSelect.value !== 'higher_lower' || barrierEngine.calibrating || isSendingOrder) return;
    if (configKey() !== barrierEngine.lastConfigKey) {
      restartMarketEngine('cambió la configuración');
      return;
    }

    const target = getTargetReturn();
    const now = Date.now();
    for (const side of ['higher', 'lower']) {
      const quote = barrierEngine.live[side];
      const stale = !quote || now - quote.updatedAt > 4500;
      const drifted = quote && Math.abs(quote.returnPct - target) > 3;
      const periodic = now - barrierEngine.lastCalibrationAt[side] > 18000;
      if (stale || drifted || periodic) {
        try {
          barrierEngine.calibrating = true;
          updateUi();
          await calibrateSide(side, barrierEngine.generation, true);
        } catch (err) {
          addLog(`Reajuste ${side.toUpperCase()}: ${err.message}`, 'warn');
        } finally {
          barrierEngine.calibrating = false;
          updateUi();
        }
      }
    }
  }, 3000);
}

async function stopBarrierEngine() {
  barrierEngine.generation += 1;
  barrierEngine.running = false;
  barrierEngine.calibrating = false;
  if (barrierEngine.timer) clearInterval(barrierEngine.timer);
  barrierEngine.timer = null;
  await stopProposalSubscriptionsOnly();
  if (tickSubscriptionId && ws?.readyState === WebSocket.OPEN) {
    try { await send({ forget: tickSubscriptionId }, 5000); } catch (_) {}
  }
  tickSubscriptionId = null;
  currentSpot = null;
  recentQuotes = [];
  barrierEngine.live = { higher: null, lower: null };
  updateUi();
}

let restartTimer = null;
function scheduleMarketRestart(reason) {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => restartMarketEngine(reason), 500);
}

async function restartMarketEngine(reason) {
  if (!isAuthorized) return;
  if (els.modeSelect.value === 'higher_lower') {
    await startBarrierEngine(reason);
  } else {
    await stopBarrierEngine();
  }
}

async function getFreshTradeQuote(side) {
  const cached = barrierEngine.live[side];
  const now = Date.now();
  if (cached && now - cached.updatedAt <= 1200) return cached;

  if (cached?.distance) {
    try {
      const { quote } = await requestBarrierQuote(side, cached.distance, false);
      barrierEngine.live[side] = quote;
      updateUi();
      return quote;
    } catch (_) {}
  }

  const generation = barrierEngine.generation;
  const best = await findBestBarrier(side, generation, true);
  barrierEngine.live[side] = best;
  updateUi();
  return best;
}

async function buyWithRetry(quote, side) {
  try {
    return await send({ buy: quote.id, price: quote.askPrice });
  } catch (firstError) {
    const { quote: refreshed } = await requestBarrierQuote(side, quote.distance, false);
    barrierEngine.live[side] = refreshed;
    updateUi();
    try {
      return await send({ buy: refreshed.id, price: refreshed.askPrice });
    } catch (_) {
      const fallback = await findBestBarrier(side, barrierEngine.generation, true);
      barrierEngine.live[side] = fallback;
      updateUi();
      return send({ buy: fallback.id, price: fallback.askPrice });
    }
  }
}

async function executeTrade(side) {
  if (!isAuthorized || isSendingOrder) return;

  if (window.derivBrowserMode) {
    try {
      await readBrowserStateForOrder();
    } catch (error) {
      addLog(error.message, 'err');
      return;
    }
  }

  saveSettings();

  const mode = els.modeSelect.value;
  const symbol = getSymbol();
  const stake = getStake();
  const duration = Number(els.durationInput.value || 1);
  const durationUnit = els.durationUnitSelect.value;
  const accountLabel = getAccountLabel(activeAccountMode);

  if (!symbol) {
    addLog('Falta seleccionar/cargar el símbolo.', 'err');
    return;
  }

  isSendingOrder = true;
  updateUi();

  try {
    let quote;
    let contractLabel;

    if (mode === 'higher_lower') {
      const barrierSide = side === 'buy' ? 'higher' : 'lower';
      addLog(`[${accountLabel}] Refrescando ${barrierSide.toUpperCase()} para entrar cerca de ${getTargetReturn().toFixed(0)}%…`, 'warn');
      quote = await getFreshTradeQuote(barrierSide);
      contractLabel = `${barrierSide.toUpperCase()} ${quote.returnPct.toFixed(1)}% · barrera ${quote.barrier}`;

      if (activeAccountMode === 'real') {
        const confirmed = window.confirm(`Vas a operar en cuenta REAL.\n\n${contractLabel}\n${symbol}\nStake: ${stake.toFixed(2)} ${currency}\n\n¿Confirmás la orden?`);
        if (!confirmed) {
          addLog('Orden REAL cancelada por confirmación manual.', 'warn');
          isSendingOrder = false;
          updateUi();
          return;
        }
      }

      const buy = await buyWithRetry(quote, barrierSide);
      const contractId = buy.buy?.contract_id;
      if (!contractId) throw new Error('Deriv no devolvió contract_id');
      const paid = Number(buy.buy?.buy_price ?? quote.askPrice);
      addLog(`[${accountLabel}] Comprado ${contractId} · ${contractLabel} · ${paid.toFixed(2)} ${currency}`, 'ok');
      await subscribeContract(contractId);
      return;
    }

    const contractType = side === 'buy' ? 'CALL' : 'PUT';
    if (activeAccountMode === 'real') {
      const confirmed = window.confirm(`Vas a operar en cuenta REAL.\n\n${contractType} ${symbol}\nStake: ${stake.toFixed(2)} ${currency}\n\n¿Confirmás la orden?`);
      if (!confirmed) {
        addLog('Orden REAL cancelada por confirmación manual.', 'warn');
        isSendingOrder = false;
        updateUi();
        return;
      }
    }

    const proposalReq = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: contractType,
      currency,
      duration,
      duration_unit: durationUnit,
      underlying_symbol: symbol
    };
    const proposal = await send(proposalReq);
    const proposalId = proposal.proposal?.id;
    const askPrice = Number(proposal.proposal?.ask_price || stake);
    if (!proposalId) throw new Error('Deriv no devolvió proposal_id');
    const buy = await send({ buy: proposalId, price: askPrice });
    const contractId = buy.buy?.contract_id;
    if (!contractId) throw new Error('Deriv no devolvió contract_id');
    addLog(`[${accountLabel}] Comprado contrato ${contractId} · ${contractType} · ${askPrice.toFixed(2)} ${currency}`, 'ok');
    await subscribeContract(contractId);
  } catch (err) {
    addLog(`[${accountLabel}] Orden rechazada: ${err.message}`, 'err');
    isSendingOrder = false;
    updateUi();
  }
}

async function subscribeContract(contractId) {
  const res = await send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  if (res.subscription?.id) contractSubscriptionId = res.subscription.id;
  if (res.proposal_open_contract) handleContractUpdate(res.proposal_open_contract, res.subscription?.id);
}

async function handleContractUpdate(contract, subId) {
  if (subId) contractSubscriptionId = subId;
  if (!contract.is_sold) return;

  const profit = Number(contract.profit || 0);
  const result = profit > 0 ? 'ITM' : 'OTM';
  els.lastResultText.textContent = `${result} ${profit.toFixed(2)}`;
  addLog(`[${getAccountLabel(activeAccountMode)}] ${result} · profit ${profit.toFixed(2)} ${currency} · recalculando IC`, profit > 0 ? 'ok' : 'err');
  isSendingOrder = false;

  try {
    if (contractSubscriptionId) await send({ forget: contractSubscriptionId });
  } catch (_) {}

  try {
    const b = await send({ balance: 1 });
    if (b.balance) balance = Number(b.balance.balance);
  } catch (_) {}

  contractSubscriptionId = null;
  updateUi();
  scheduleMarketRestart('terminó la operación y cambió el saldo');
}

async function listOptionsAccounts() {
  saveSettings();
  const appId = String(els.appIdInput.value || '').trim();
  const token = getSelectedToken();
  const label = getAccountLabel(getSelectedAccountMode());

  els.accountsBox.classList.remove('hidden');
  els.accountsBox.innerHTML = 'Buscando cuentas...';
  els.accountsBtn.disabled = true;

  try {
    if (!hasElectronApi('getOptionsAccounts')) {
      showElectronMissing('Buscar cuentas');
      return;
    }
    const data = await getElectronApi().getOptionsAccounts({ appId, token });
    const accounts = Array.isArray(data) ? data : (Array.isArray(data?.accounts) ? data.accounts : []);
    if (!accounts.length) {
      els.accountsBox.innerHTML = 'No se encontraron cuentas en la respuesta.';
      addLog(`No se encontraron cuentas Options usando token ${label}.`, 'warn');
      return;
    }

    els.accountsBox.innerHTML = accounts.map((acc) => {
      const id = acc.account_id || acc.id || acc.loginid || acc.accountId || '';
      const type = acc.account_type || acc.type || acc.group || '';
      const cur = acc.currency || '';
      return `<button class="accountChoice" data-id="${escapeHtml(id)}">${escapeHtml(id)} <span>${escapeHtml(type)} ${escapeHtml(cur)}</span></button>`;
    }).join('');

    els.accountsBox.querySelectorAll('.accountChoice').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || '';
        if (getSelectedAccountMode() === 'real') els.realAccountIdInput.value = id;
        else els.demoAccountIdInput.value = id;
        saveSettings();
        updateUi();
        addLog(`Account ID ${label} cargado: ${id}`, 'ok');
      });
    });
    addLog(`Cuentas Options encontradas para ${label}. Tocá una para cargarla.`, 'ok');
  } catch (err) {
    els.accountsBox.innerHTML = escapeHtml(`Error: ${err.message}`);
    addLog(`Error buscando cuentas: ${err.message}`, 'err');
  } finally {
    els.accountsBtn.disabled = false;
  }
}

els.oauthLoginBtn.addEventListener('click', oauthLogin);
els.connectBtn.addEventListener('click', connect);
els.accountsBtn.addEventListener('click', listOptionsAccounts);
els.buyBtn.addEventListener('click', () => executeTrade('buy'));
els.sellBtn.addEventListener('click', () => executeTrade('sell'));
els.accountModeSelect.addEventListener('change', () => {
  saveSettings();
  if (isAuthorized) {
    addLog(`Cambio a modo ${getAccountLabel(getSelectedAccountMode())}. Reconectá para usar esa cuenta.`, 'warn');
    disconnect();
  }
  updateUi();
});
els.modeSelect.addEventListener('change', () => {
  saveSettings();
  updateUi();
  scheduleMarketRestart('cambió el tipo de contrato');
});

[
  els.durationInput,
  els.durationUnitSelect,
  els.targetReturnInput,
  els.stepInput,
  els.maxInput,
  els.pctInput,
  els.appIdInput,
  els.redirectUriInput,
  els.demoAccountIdInput,
  els.realAccountIdInput,
  els.demoTokenInput,
  els.realTokenInput
].forEach(el => {
  el.addEventListener('change', () => {
    saveSettings();
    updateUi();
    if ([els.durationInput, els.durationUnitSelect, els.targetReturnInput, els.stepInput, els.maxInput, els.pctInput].includes(el)) {
      scheduleMarketRestart('cambió un parámetro');
    }
  });
  el.addEventListener('input', () => {
    saveSettings();
    updateUi();
  });
});

els.clearLogBtn.addEventListener('click', () => {
  tradeLog = [];
  localStorage.removeItem('tradeLog');
  renderLog();
});

window.addEventListener('browser-state-updated', (event) => {
  if (!window.derivBrowserMode) return;
  const state = event.detail || {};
  applyBrowserStateToTrading(state, true);
});

window.addEventListener('active-symbol-changed', (event) => {
  const symbol = String(event.detail?.symbol || '').trim();
  if (symbol && els.symbolSelect) els.symbolSelect.value = symbol;
  saveSettings();
  if (isAuthorized) scheduleMarketRestart('cambió el gráfico activo');
});

(function initTradingPanel() {
  loadSettings();
  if (els.symbolSelect) {
    els.symbolSelect.value = String(document.getElementById('selectedSymbol')?.textContent || 'R_10').trim();
  }
  renderLog();
  updateUi();
  updateElectronEnvironmentUi();
})();


export function disconnectTradingAccount() { disconnect(); }
