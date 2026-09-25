import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { autoUpdater } from 'electron-updater';
import 'source-map-support/register';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
	// Create the browser window.
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 720,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			// Enable debugging
			devTools: true,
		},
	});

	// In production, load the bundled app
	if (app.isPackaged) {
		mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
	} else {
		// In development, load from the dev server. The URL is overridable
		// because the port is not fixed any more: several worktrees of this
		// repo run their own dev server at once, and the Playwright harness
		// derives its port from the checkout path
		// (`playwright.config.ts`, DEV_SERVER_PORT).
		const rendererUrl = process.env.DDB_RENDERER_URL ?? 'http://localhost:9000';
		mainWindow.loadURL(rendererUrl);

		// DevTools docks to the right of the web contents and takes its width
		// from them, so a screenshot run has to open without it or every
		// capture is of a narrower page than the harness asked for.
		if (!process.env.DDB_RENDERER_URL) {
			mainWindow.webContents.openDevTools();
		}

		// Log startup for output monitoring
		console.log('Electron application starting in development mode');
	}

	// Log errors for output monitoring
	mainWindow.webContents.on('console-message', (event, level, message, _line, _sourceId) => {
		const levels = ['log', 'warning', 'error', 'info', 'debug'];
		console.log(`[Renderer] [${levels[level]}]: ${message}`);
	});

	// Set native menu
	const template = [
		{
			label: 'File',
			submenu: [{ role: 'quit' }],
		},
		{
			label: 'View',
			submenu: [
				{ role: 'reload' },
				{ role: 'forceReload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
			],
		},
	];

	const menu = Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]);
	Menu.setApplicationMenu(menu);
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
	createWindow();

	app.on('activate', () => {
		// On macOS, re-create a window when the dock icon is clicked
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	// Check for updates; without an error listener a failed check (e.g. no
	// published releases yet) becomes an unhandled rejection in main
	if (app.isPackaged) {
		autoUpdater.on('error', (error) => {
			console.error('Update check failed:', error);
		});
		autoUpdater.checkForUpdatesAndNotify();
	}
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
