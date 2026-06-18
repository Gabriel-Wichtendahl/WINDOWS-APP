const { app, BrowserWindow, ipcMain, screen } = require('electron');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

let mainWindow;
let pinned = false;
let compactMode = false;
let normalBounds = null;
let pinnedBeforeCompact = false;
let syncServer = null;

const SYNC_PORT = 17858;
const VALID_SYMBOLS = new Set(['R_10', 'R_25', 'R_50', 'R_75', 'R_100']);
let browserState = {
  connected: false,
  derivDetected: false,
  symbol: null,
  label: null,
  contractMode: null,
  title: '',
  url: '',
  receivedAt: 0
};

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}

function normalizeBrowserState(input = {}) {
  const symbol = VALID_SYMBOLS.has(String(input.symbol || '').toUpperCase())
    ? String(input.symbol).toUpperCase()
    : null;
  const contractMode = ['rise_fall', 'higher_lower'].includes(input.contractMode)
    ? input.contractMode
    : null;

  return {
    connected: true,
    derivDetected: Boolean(input.derivDetected),
    symbol,
    label: String(input.label || '').slice(0, 80),
    contractMode,
    contractConfidence: Math.max(0, Math.min(5, Number(input.contractConfidence || 0))),
    title: String(input.title || '').slice(0, 180),
    url: String(input.url || '').slice(0, 600),
    receivedAt: Date.now()
  };
}

function broadcastBrowserState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('browser-state', browserState);
  }
}

function startBrowserSyncServer() {
  if (syncServer) return;
  syncServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, app: 'Deriv IC', port: SYNC_PORT });
      return;
    }

    if (req.method === 'GET' && req.url === '/state') {
      sendJson(res, 200, browserState);
      return;
    }

    if (req.method === 'POST' && req.url === '/state') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 65536) req.destroy();
      });
      req.on('end', () => {
        try {
          browserState = normalizeBrowserState(JSON.parse(raw || '{}'));
          broadcastBrowserState();
          sendJson(res, 200, { ok: true, receivedAt: browserState.receivedAt });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  syncServer.on('error', (error) => {
    console.error('Deriv browser sync server:', error);
  });

  syncServer.listen(SYNC_PORT, '127.0.0.1');
}


function applyPinned(value) {
  pinned = Boolean(value);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(pinned, pinned ? 'floating' : 'normal');
    mainWindow.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
    if (pinned) mainWindow.moveTop();
  }
  return { enabled: pinned, actual: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isAlwaysOnTop()) };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1580,
    height: 930,
    minWidth: 1150,
    minHeight: 700,
    title: 'Deriv IC — 5 gráficos / Navegador',
    backgroundColor: '#10131d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));
}

app.whenReady().then(() => {
  startBrowserSyncServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  try { syncServer?.close(); } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('set-pinned', (_event, value) => applyPinned(value));
ipcMain.handle('get-pinned', () => pinned);

ipcMain.handle('get-browser-state', () => browserState);

ipcMain.handle('set-window-mode', (_event, mode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { mode: 'full' };

  if (mode === 'compact') {
    if (!compactMode) {
      normalBounds = mainWindow.getBounds();
      pinnedBeforeCompact = pinned;
    }
    compactMode = true;

    const current = mainWindow.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const width = Math.min(370, area.width);
    const height = Math.min(760, area.height - 18);
    const x = Math.max(area.x, Math.min(current.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(current.y, area.y + area.height - height));

    mainWindow.setMinimumSize(330, 520);
    mainWindow.setBounds({ x, y, width, height }, true);
    mainWindow.setTitle('Deriv IC — Modo navegador');
    applyPinned(true);
    return { mode: 'compact', bounds: mainWindow.getBounds(), pinned: true };
  }

  compactMode = false;
  mainWindow.setMinimumSize(1150, 700);
  const fallback = { width: 1580, height: 930 };
  mainWindow.setBounds(normalBounds || { ...mainWindow.getBounds(), ...fallback }, true);
  mainWindow.setTitle('Deriv IC — 5 gráficos');
  applyPinned(pinnedBeforeCompact);
  return { mode: 'full', bounds: mainWindow.getBounds(), pinned };
});

ipcMain.handle('get-window-mode', () => compactMode ? 'compact' : 'full');

ipcMain.handle('toggle-always-on-top', () => applyPinned(!pinned));
ipcMain.handle('set-always-on-top', (_event, enabled) => applyPinned(enabled));
ipcMain.handle('is-always-on-top', () => applyPinned(pinned));

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPkce() {
  const codeVerifier = base64Url(crypto.randomBytes(64));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = crypto.randomBytes(16).toString('hex');
  return { codeVerifier, codeChallenge, state };
}

async function exchangeOAuthCode({ clientId, redirectUri, code, codeVerifier }) {
  const response = await fetch('https://auth.deriv.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });

  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  if (!response.ok) {
    const msg = body?.error_description || body?.error || body?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  if (!body?.access_token) throw new Error('Deriv no devolvió access_token.');
  return body;
}

ipcMain.handle('oauth-login', async (_event, { clientId, redirectUri }) => {
  const cleanClientId = String(clientId || '').trim();
  const cleanRedirectUri = String(redirectUri || '').trim();

  if (!cleanClientId) throw new Error('Falta Client ID / App ID nuevo de Deriv.');
  if (!cleanRedirectUri) throw new Error('Falta Redirect URL.');
  if (!/^https:\/\//i.test(cleanRedirectUri)) throw new Error('La Redirect URL debe empezar con https://');

  const { codeVerifier, codeChallenge, state } = createPkce();
  const authUrl = new URL('https://auth.deriv.com/oauth2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cleanClientId);
  authUrl.searchParams.set('redirect_uri', cleanRedirectUri);
  authUrl.searchParams.set('scope', 'trade account_manage');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return new Promise((resolve, reject) => {
    let finished = false;
    const authWindow = new BrowserWindow({
      width: 560,
      height: 780,
      title: 'Login Deriv OAuth',
      parent: mainWindow || undefined,
      modal: false,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      backgroundColor: '#111827',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    authWindow.setAlwaysOnTop(true, 'screen-saver');
    authWindow.loadURL(authUrl.toString());

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      try {
        if (!authWindow.isDestroyed()) authWindow.close();
      } catch (_) {}
      fn(value);
    };

    const handleUrl = async (navigationUrl) => {
      if (!navigationUrl || !String(navigationUrl).startsWith(cleanRedirectUri)) return false;

      try {
        const parsed = new URL(navigationUrl);
        const error = parsed.searchParams.get('error');
        const errorDescription = parsed.searchParams.get('error_description');
        if (error) throw new Error(errorDescription || error);

        const code = parsed.searchParams.get('code');
        const returnedState = parsed.searchParams.get('state');
        if (!code) throw new Error('Deriv no devolvió authorization code.');
        if (returnedState !== state) throw new Error('State inválido. Se canceló el login por seguridad.');

        const tokenData = await exchangeOAuthCode({
          clientId: cleanClientId,
          redirectUri: cleanRedirectUri,
          code,
          codeVerifier
        });

        finish(resolve, tokenData);
      } catch (err) {
        finish(reject, err);
      }

      return true;
    };

    authWindow.webContents.on('will-redirect', (event, navigationUrl) => {
      if (String(navigationUrl).startsWith(cleanRedirectUri)) {
        event.preventDefault();
        handleUrl(navigationUrl);
      }
    });

    authWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      if (String(navigationUrl).startsWith(cleanRedirectUri)) {
        event.preventDefault();
        handleUrl(navigationUrl);
      }
    });

    authWindow.webContents.on('did-navigate', (_event, navigationUrl) => {
      handleUrl(navigationUrl);
    });

    authWindow.on('closed', () => {
      if (!finished) finish(reject, new Error('Login cancelado.'));
    });
  });
});

ipcMain.handle('get-otp-websocket-url', async (_event, { appId, token, accountId }) => {
  const cleanAppId = String(appId || '').trim();
  const cleanToken = String(token || '').trim();
  const cleanAccountId = String(accountId || '').trim();

  if (!cleanAppId) throw new Error('Falta App ID nuevo de Deriv.');
  if (!cleanToken) throw new Error('Falta Authorization token / Bearer token.');
  if (!cleanAccountId) throw new Error('Falta Account ID de Options.');

  const url = `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(cleanAccountId)}/otp`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Deriv-App-ID': cleanAppId,
      'Authorization': `Bearer ${cleanToken}`
    }
  });

  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  if (!response.ok) {
    const msg = body?.errors?.[0]?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  const wsUrl = body?.data?.url;
  if (!wsUrl) throw new Error('Deriv no devolvió URL WebSocket OTP.');
  return wsUrl;
});

ipcMain.handle('get-options-accounts', async (_event, { appId, token }) => {
  const cleanAppId = String(appId || '').trim();
  const cleanToken = String(token || '').trim();

  if (!cleanAppId) throw new Error('Falta App ID nuevo de Deriv.');
  if (!cleanToken) throw new Error('Falta Authorization token / Bearer token.');

  const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
    method: 'GET',
    headers: {
      'Deriv-App-ID': cleanAppId,
      'Authorization': `Bearer ${cleanToken}`
    }
  });

  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  if (!response.ok) {
    const msg = body?.errors?.[0]?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  return body?.data || body;
});
