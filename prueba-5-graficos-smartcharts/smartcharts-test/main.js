const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let pinned = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1580,
    height: 930,
    minWidth: 1150,
    minHeight: 700,
    title: 'Deriv 5 Gráficos — prueba SmartCharts',
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('set-pinned', (_event, value) => {
  pinned = Boolean(value);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(pinned, pinned ? 'floating' : 'normal');
    if (pinned) mainWindow.moveTop();
  }
  return pinned;
});

ipcMain.handle('get-pinned', () => pinned);
