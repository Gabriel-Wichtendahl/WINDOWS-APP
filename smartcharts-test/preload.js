const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  setPinned: (value) => ipcRenderer.invoke('set-pinned', value),
  getPinned: () => ipcRenderer.invoke('get-pinned')
});

contextBridge.exposeInMainWorld('electronAPI', {
  isElectronBridge: true,
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('set-always-on-top', enabled),
  isAlwaysOnTop: () => ipcRenderer.invoke('is-always-on-top'),
  oauthLogin: (payload) => ipcRenderer.invoke('oauth-login', payload),
  getOtpWebSocketUrl: (payload) => ipcRenderer.invoke('get-otp-websocket-url', payload),
  getOptionsAccounts: (payload) => ipcRenderer.invoke('get-options-accounts', payload)
});
