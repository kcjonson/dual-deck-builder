#!/usr/bin/env node
// R15.34 smoke test: launch the packaged app (the one electron-builder wrote to
// release/, running its renderer from file:// out of the asar) and check the
// font atlases load there. The failure this guards against is a runtime file
// request that works on the dev server and fails from file://; the atlases
// are bundled (JSON as modules, PNG as data URIs) so there should be none.
//
// Usage, after `npm run build:electron` and `npm run package:<platform>`
// (or `npx electron-builder --dir` for an unpacked build only):
//   node scripts/smoke-electron-package.mjs [path/to/executable]
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const PRODUCT_NAME = 'Dual Deckbuilder';
const RELEASE_DIR = resolve(import.meta.dirname, '..', 'release');
const TIMEOUT_MS = 60_000;

function findExecutable() {
	if (!existsSync(RELEASE_DIR)) return null;
	const entries = readdirSync(RELEASE_DIR);
	const candidates = [];
	if (process.platform === 'darwin') {
		for (const entry of entries.filter((name) => name.startsWith('mac'))) {
			candidates.push(join(RELEASE_DIR, entry, `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME));
		}
	} else if (process.platform === 'win32') {
		candidates.push(join(RELEASE_DIR, 'win-unpacked', `${PRODUCT_NAME}.exe`));
	} else {
		candidates.push(join(RELEASE_DIR, 'linux-unpacked', 'dual-deck-builder'));
	}
	return candidates.find((path) => existsSync(path)) ?? null;
}

function fail(message) {
	console.error(`Packaged smoke test failed: ${message}`);
	process.exitCode = 1;
}

const executablePath = process.argv[2] ? resolve(process.argv[2]) : findExecutable();
if (!executablePath || !existsSync(executablePath)) {
	fail(`no packaged executable found under ${RELEASE_DIR}; package the app first or pass its path`);
	process.exit();
}

console.log(`Launching ${executablePath}`);
const application = await electron.launch({
	executablePath,
	args: process.platform === 'linux' ? ['--no-sandbox'] : [],
	timeout: TIMEOUT_MS,
});

try {
	const page = await application.firstWindow({ timeout: TIMEOUT_MS });
	const consoleErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => consoleErrors.push(String(error)));
	const imageRequests = [];
	page.on('request', (request) => {
		if (request.resourceType() === 'image' && !request.url().startsWith('data:')) imageRequests.push(request.url());
	});
	// The first load may be under way before these listeners exist; a reload
	// puts the whole startup, font load included, in front of them.
	await page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_MS });
	await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

	const protocol = await page.evaluate(() => location.protocol);
	if (protocol !== 'file:') fail(`expected the packaged renderer on file://, got ${protocol}`);

	// The two marks src/index.ts sets when the font atlas load settles.
	const handle = await page.waitForFunction(() => {
		const [entry] = [
			...performance.getEntriesByName('font-atlases-ready'),
			...performance.getEntriesByName('font-atlases-failed'),
		];
		return entry ? { name: entry.name, detail: entry.detail } : null;
	}, undefined, { timeout: TIMEOUT_MS });
	const outcome = await handle.jsonValue();

	if (outcome.name === 'font-atlases-ready') {
		console.log(`Font atlases loaded from file://: ${outcome.detail.faces.join(', ')}`);
	} else {
		fail(`font atlases did not load: ${outcome.detail.message}`);
	}

	// Inline means no image request at all, not merely a successful one.
	if (imageRequests.length > 0) fail(`images were requested as files: ${imageRequests.join(', ')}`);

	// Reported, not failed on: a runner without a usable GL context logs a
	// renderer error that says nothing about the asset path under test.
	for (const message of consoleErrors) console.warn(`Renderer console error: ${message}`);
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
} finally {
	await application.close();
}
