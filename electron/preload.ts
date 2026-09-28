// Preload script: bridges the isolated renderer to the main process.
// Environment info, and the clipboard the engine's ClipboardService reads
// as `window.electron.clipboard`; add IPC methods here alongside their
// ipcMain handlers when the renderer actually needs them.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
	isElectron: true,
	platform: process.platform,
	clipboard: {
		readText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
		writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
	},
});
