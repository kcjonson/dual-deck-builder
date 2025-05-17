// Preload script runs in Electron's renderer process with access 
// to Node.js APIs and limited access to main process via contextBridge
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// specific Electron APIs without exposing all of Electron
contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,
  // Expose specific IPC methods for communication with the main process
  send: (channel: string, data: any) => {
    // Whitelist channels we want to send to
    const validChannels = ['app-quit', 'app-minimize', 'app-maximize', 'check-for-update'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel: string, func: (...args: any[]) => void) => {
    // Whitelist channels we want to receive
    const validChannels = ['update-available', 'update-downloaded', 'update-error'];
    if (validChannels.includes(channel)) {
      // Strip event as it includes `sender` and other internal electron properties
      ipcRenderer.on(channel, (_, ...args) => func(...args));
    }
  },
  // Expose any synchronous methods
  getAppVersion: () => ipcRenderer.sendSync('get-app-version')
});

// The preload script will run before the renderer process is loaded,
// and has access to both Node.js APIs and the window object
window.addEventListener('DOMContentLoaded', () => {
  console.log('Electron renderer process initialized');
});
