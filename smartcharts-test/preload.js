const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopAPI', {
  setPinned: (value) => ipcRenderer.invoke('set-pinned', value),
  getPinned: () => ipcRenderer.invoke('get-pinned')
});
