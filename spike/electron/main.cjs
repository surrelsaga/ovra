// Spike: Electron renderer SDK fed by a test video via canvas.captureStream() + useMediaStream().
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
const video = process.env.SPIKE_VIDEO;
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: require.resolve('@smartspectra/node-sdk/preload'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  bindSmartSpectraIpc(win);
  win.webContents.on('console-message', (e) => { const m = e.message ?? e; if (String(m).startsWith('SPIKE')) { console.log(String(m)); if (String(m).startsWith('SPIKE DONE')) app.quit(); } });
  const q = new URLSearchParams({ video: 'file://' + video, dur: process.env.DUR ?? '70' });
  win.loadFile(path.join(__dirname, 'index.html'), { hash: q.toString() + '&key=' + encodeURIComponent(process.env.PRESAGE_API_KEY) });
});
