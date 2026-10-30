import { createHash } from 'node:crypto';
import { defineConfig } from '@playwright/test';

/**
 * The boot smoke (DDB-536, docs/AI_TECHNICAL_DECISIONS/prototype-ci.md).
 *
 * Two projects. `production` loads the bundle `build:web` ships to the
 * playtest host, served the way that host serves it, and checks it boots past
 * the splash with a clean console. `screens` drives the dev server's hooks to
 * open every game screen once and checks each one mounts, loads, keeps
 * drawing, and logs no error. Nothing compares pixels and nothing is
 * baselined: the UI changes daily, and the job is to fail loudly when the game
 * can't start or a screen can't open.
 *
 * Runs on main after merge (.github/workflows/main.yml), and locally with
 * `npm run test:smoke`.
 */

/**
 * Chromium dropped the automatic SwiftShader fallback in version 137, so a
 * headless WebGL context needs these switches or it fails to create, and
 * `Renderer` throwing on a null context reaches the page as a black canvas
 * and a console error (R15.33).
 */
export const SWIFTSHADER_ARGS = [
	'--use-gl=angle',
	'--use-angle=swiftshader-webgl',
	'--enable-unsafe-swiftshader',
];

/**
 * A worktree-stable port. Several worktrees of this repo run at once and
 * webpack's configured 9000 is first-come-first-served, so the port comes
 * from this checkout's path, and `reuseExistingServer: false` turns a
 * collision into a failure rather than a run against someone else's server.
 */
const DEV_SERVER_PORT = Number(process.env.DDB_SMOKE_PORT)
	|| 9100 + (createHash('sha256').update(__dirname).digest()[0] % 100);
const STATIC_SERVER_PORT = DEV_SERVER_PORT + 100;

export const BASE_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const PRODUCTION_URL = `http://127.0.0.1:${STATIC_SERVER_PORT}`;

export default defineConfig({
	testDir: './tests/smoke',
	workers: process.env.CI ? 2 : 1,
	forbidOnly: !!process.env.CI,
	// A boot that passes on a retry is a boot that sometimes fails, which is what this is here to say.
	retries: 0,
	timeout: 60_000,
	reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
	use: {
		browserName: 'chromium',
		viewport: { width: 1440, height: 882 },
		deviceScaleFactor: 1,
		launchOptions: { args: SWIFTSHADER_ARGS },
		trace: 'off',
	},
	projects: [
		{
			name: 'production',
			testMatch: /production\/.*\.spec\.ts$/,
			use: { baseURL: PRODUCTION_URL },
		},
		{
			name: 'screens',
			testMatch: /screens\/.*\.spec\.ts$/,
			use: { baseURL: BASE_URL },
		},
	],
	webServer: [
		{
			// A development build: the screens project drives __DEV_TOOLS__ hooks a
			// production bundle doesn't have. --no-hot keeps HMR from reloading a
			// page mid-test.
			command: `npm start -- --port ${DEV_SERVER_PORT} --no-hot --no-client-overlay`,
			url: BASE_URL,
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: 'ignore',
			stderr: 'pipe',
		},
		{
			// dist/web as `build:web` left it; `npm run test:smoke` builds it first.
			command: `node scripts/serve-static.mjs dist/web ${STATIC_SERVER_PORT}`,
			url: PRODUCTION_URL,
			reuseExistingServer: false,
			timeout: 30_000,
			stdout: 'ignore',
			stderr: 'pipe',
		},
	],
});
