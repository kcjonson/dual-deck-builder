// Preload script: bridges the isolated renderer to the main process.
// Only environment info is exposed today; add IPC methods here alongside
// their ipcMain handlers when the renderer actually needs them.
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electron', {
	isElectron: true,
	platform: process.platform,
});
