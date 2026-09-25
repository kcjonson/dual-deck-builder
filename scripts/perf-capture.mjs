/**
 * R13.38's capture script: drive a development build through a fixed list of
 * scenarios, sample `window.__perf.snapshot()` N times per scenario after a
 * settle period, and write `perf-results/<label>.json` as
 * `[ { "scenario", "samples": [snapshot...] } ]`.
 *
 *   node scripts/perf-capture.mjs --label phase0-frame-baseline \
 *     --url http://localhost:9061/ splashScreen mainMenuScreen
 *
 * It drives headless Chrome over the DevTools protocol with no dependencies
 * beyond Node's own WebSocket, for two reasons. The first is that it has to be
 * headless: an occluded or backgrounded tab has its rAF frozen by Chrome, the
 * game loop stops between wakes, and the timer honestly reports the 88 second
 * "frame" that results, which is not a baseline. The second is R13.38's other
 * half, that vsync and frame capping are off during the capture; in a browser
 * that is a launch flag rather than an in-page call, and killing the browser at
 * the end is what restores it. Frame times here are therefore unthrottled: they
 * say how much of the budget a scene costs, not what a vsync-paced run displays.
 *
 * The chapter 13 mapping table names Playwright as the browser answer. When a
 * Playwright harness lands it should replace this file rather than run beside
 * it; two capture paths would eventually disagree about what was captured.
 *
 * The per-scenario name is passed to `__app.navigate` (game page) or
 * `__app.scene` (gallery), whichever the page installed.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME_CANDIDATES = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome',
];

function parseArguments(argv) {
	const options = {
		label: 'capture',
		url: 'http://localhost:9000/',
		port: 9223,
		width: 1440,
		height: 882,
		settleFrames: 120,
		samples: 20,
		chrome: null,
		scenarios: [],
	};
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument.startsWith('--')) {
			const key = argument.slice(2);
			if (!(key in options)) throw new Error(`unknown option --${key}`);
			const value = argv[++index];
			options[key] = typeof options[key] === 'number' ? Number(value) : value;
		} else {
			options.scenarios.push(argument);
		}
	}
	if (options.scenarios.length === 0) throw new Error('name at least one scenario');
	return options;
}

const options = parseArguments(process.argv.slice(2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(options.chrome ?? CHROME_CANDIDATES.find((path) => existsSync(path)), [
	'--headless=new',
	`--remote-debugging-port=${options.port}`,
	`--window-size=${options.width},${options.height}`,
	'--force-device-scale-factor=1',
	// R13.38: vsync and the frame cap are off for the capture. Killing the
	// browser at the end is what restores them.
	'--disable-frame-rate-limit',
	'--disable-gpu-vsync',
	'--no-first-run',
	'--no-default-browser-check',
	// Its own profile, so a capture neither waits on nor disturbs the browser
	// the person running it already has open.
	`--user-data-dir=${join(tmpdir(), 'ddb-perf-capture-profile')}`,
	options.url,
], { stdio: 'ignore' });

async function debuggerUrl() {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const targets = await fetch(`http://127.0.0.1:${options.port}/json/list`).then((response) => response.json());
			const page = targets.find((target) => target.type === 'page' && target.url.startsWith(options.url));
			if (page) return page.webSocketDebuggerUrl;
		} catch {
			// The browser has not opened its port yet.
		}
		await sleep(500);
	}
	throw new Error('no page target; is the dev server running?');
}

const socket = new WebSocket(await debuggerUrl());
await new Promise((resolve, reject) => {
	socket.addEventListener('open', resolve, { once: true });
	socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
	const message = JSON.parse(event.data);
	const settle = pending.get(message.id);
	if (!settle) return;
	pending.delete(message.id);
	settle(message);
});

function send(method, params) {
	const id = nextId++;
	return new Promise((settle) => {
		pending.set(id, settle);
		socket.send(JSON.stringify({ id, method, params }));
	});
}

async function evaluate(expression) {
	const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
	if (message.error) throw new Error(JSON.stringify(message.error));
	const { result, exceptionDetails } = message.result;
	if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? String(exceptionDetails.text));
	return result.value;
}

await send('Runtime.enable');
// --window-size counts browser chrome, so the logical viewport lands short of
// what was asked for; the metrics override sets the viewport itself, which is
// the space the tree snapshot and the lint report bounds in (R7.1).
await send('Emulation.setDeviceMetricsOverride', {
	width: options.width,
	height: options.height,
	deviceScaleFactor: 1,
	mobile: false,
});

for (let attempt = 0; ; attempt++) {
	if (await evaluate('typeof window.__perf === "object" && typeof window.__app === "object"')) break;
	if (attempt > 40) throw new Error('window.__perf never appeared; is this a development build?');
	await sleep(500);
}

console.error(await evaluate('JSON.stringify({ viewport: [innerWidth, innerHeight, devicePixelRatio] })'));

const results = [];
for (const scenario of options.scenarios) {
	const mounted = await evaluate(
		`(window.__app.navigate ?? window.__app.scene)(${JSON.stringify(scenario)})`,
	);
	if (!mounted) {
		console.error(`skipped ${scenario}: the page does not know it`);
		continue;
	}
	const capture = await evaluate(`window.__perf.capture(${JSON.stringify({
		scenario,
		settleFrames: options.settleFrames,
		samples: options.samples,
	})})`);
	const last = capture.samples[capture.samples.length - 1];
	console.error(`${scenario}: frame p99 ${last.frame.p99Ms} ms, max ${last.frame.maxMs} ms, `
		+ `render max ${last.sections.render?.maxMs} ms, update max ${last.sections.update?.maxMs} ms, `
		+ `${last.renderer.glDrawCalls} draws, ${last.sanity.framesWithSectionsOverSpan} section overlaps`);
	results.push(capture);
}

const out = resolve(`perf-results/${options.label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(results, null, '\t')}\n`);
console.error(`wrote ${out}`);

socket.close();
chrome.kill();
process.exit(0);
