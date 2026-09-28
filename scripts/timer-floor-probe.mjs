/**
 * The GPU timer floor probe (DDB-193): times bare clears and draws with
 * `EXT_disjoint_timer_query_webgl2` on a canvas of its own, with and without
 * multisampling, so a per-pass floor can be told apart from real work. The
 * decision record's table in docs/AI_TECHNICAL_DECISIONS/gpu-timer-and-perf-capture.md
 * is this script's output.
 *
 *   node scripts/timer-floor-probe.mjs
 *   node scripts/timer-floor-probe.mjs --configs '[[true,1440,882],[false,1440,882]]'
 *
 * It needs no dev server: headless Chrome on about:blank, vsync on (the paced
 * clock the GPU captures use, and the only one where query results come back
 * promptly; see the decision record), device scale factor 1. Each config is
 * `[antialias, width, height]` with the page's other context attributes. Each
 * variant runs 90 frames, discards the first 30, and reports the median per
 * timed pass in ms; `DISJOINT` marks a variant whose results are unreliable.
 *
 * A variant is a list of timed passes, one query each, in frame order. A pass
 * is a list of steps: `clear` (full target), `scissorClear` (1x1), `tiny`
 * (a 1-pixel triangle), `full` (a triangle covering the target). `untimed`
 * before a pass runs its steps outside any query.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME_CANDIDATES = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome',
];

const options = { port: 9231, chrome: null, configs: '[[true,1440,882],[false,1440,882],[false,128,128]]' };
for (let index = 2; index < process.argv.length; index += 2) {
	const key = process.argv[index].replace(/^--/, '');
	if (!(key in options)) throw new Error(`unknown option --${key}`);
	options[key] = key === 'port' ? Number(process.argv[index + 1]) : process.argv[index + 1];
}

const VARIANTS = {
	'empty query': [[]],
	'one clear': [['clear']],
	'twenty clears': [Array(20).fill('clear')],
	'1-pixel scissored clear': [['scissorClear']],
	'1-pixel draw, no clear': [['tiny']],
	'clear, then three 1-pixel draws, one query each': [['clear'], ['tiny'], ['tiny'], ['tiny']],
	'clear and three 1-pixel draws, one query': [['clear', 'tiny', 'tiny', 'tiny']],
	'clear, full-screen draw, 1-pixel draw, one query each': [['clear'], ['full'], ['tiny']],
	'clear, full-screen draw, 1-pixel draw, one query': [['clear', 'full', 'tiny']],
	'untimed clear, then a timed 1-pixel draw': [{ untimed: ['clear'] }, ['tiny']],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(options.chrome ?? CHROME_CANDIDATES.find((path) => existsSync(path)), [
	'--headless=new',
	`--remote-debugging-port=${options.port}`,
	'--window-size=1440,882',
	'--force-device-scale-factor=1',
	'--no-first-run',
	'--no-default-browser-check',
	`--user-data-dir=${join(tmpdir(), `ddb-timer-floor-probe-${options.port}`)}`,
	'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

let socketUrl = null;
for (let attempt = 0; attempt < 60 && socketUrl === null; attempt++) {
	try {
		const targets = await fetch(`http://127.0.0.1:${options.port}/json/list`).then((response) => response.json());
		socketUrl = targets.find((target) => target.type === 'page')?.webSocketDebuggerUrl ?? null;
	} catch {
		// The browser has not opened its port yet.
	}
	if (socketUrl === null) await sleep(500);
}
if (socketUrl === null) throw new Error('headless Chrome did not start');

const socket = new WebSocket(socketUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
	const message = JSON.parse(event.data);
	pending.get(message.id)?.(message);
	pending.delete(message.id);
});
const send = (method, params) => new Promise((settle) => {
	const id = nextId++;
	pending.set(id, settle);
	socket.send(JSON.stringify({ id, method, params }));
});

/** Runs in the page. Everything it needs arrives as arguments. */
async function probe(configs, variants) {
	const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
	const median = (values) => {
		const sorted = [...values].sort((a, b) => a - b);
		return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
	};
	const results = { renderer: null, configs: {} };

	for (const [antialias, width, height] of configs) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		canvas.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
		document.body.appendChild(canvas);
		const gl = canvas.getContext('webgl2', {
			alpha: true, premultipliedAlpha: true, antialias, depth: false, stencil: false,
			preserveDrawingBuffer: false, powerPreference: 'high-performance',
		});
		const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
		if (!timer) return { error: 'EXT_disjoint_timer_query_webgl2 is absent' };
		const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
		results.renderer = gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER);

		const shader = (type, source) => {
			const handle = gl.createShader(type);
			gl.shaderSource(handle, source);
			gl.compileShader(handle);
			return handle;
		};
		const program = gl.createProgram();
		gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\nuniform float size;\nvoid main() {\n\tvec2 corners[3] = vec2[3](vec2(-1.0), vec2(-1.0 + size, -1.0), vec2(-1.0, -1.0 + size));\n\tgl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);\n}'));
		gl.attachShader(program, shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0, 0.0, 0.0, 1.0); }'));
		gl.linkProgram(program);
		gl.useProgram(program);
		const size = gl.getUniformLocation(program, 'size');

		const run = (step, index) => {
			if (step === 'clear') {
				gl.clearColor(index % 2, 0.2, 0.3, 1);
				gl.clear(gl.COLOR_BUFFER_BIT);
			} else if (step === 'scissorClear') {
				gl.enable(gl.SCISSOR_TEST);
				gl.scissor(0, 0, 1, 1);
				gl.clear(gl.COLOR_BUFFER_BIT);
				gl.disable(gl.SCISSOR_TEST);
			} else {
				// 'tiny' is a triangle about a pixel across; 'full' covers the target.
				gl.uniform1f(size, step === 'tiny' ? 2 / Math.max(width, height) : 4);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		};

		const byVariant = {};
		for (const [name, passes] of Object.entries(variants)) {
			const frames = [];
			for (let frame = 0; frame < 90; frame++) {
				await nextFrame();
				frames.push(passes.map((pass) => {
					if (!Array.isArray(pass)) {
						pass.untimed.forEach(run);
						return null;
					}
					const query = gl.createQuery();
					gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
					pass.forEach(run);
					gl.endQuery(timer.TIME_ELAPSED_EXT);
					return query;
				}));
			}
			for (let wait = 0; wait < 30; wait++) await nextFrame();
			const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
			const perPass = passes.map(() => []);
			for (const queries of frames.slice(30)) {
				queries.forEach((query, index) => {
					if (query === null || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
					perPass[index].push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
				});
			}
			for (const queries of frames) for (const query of queries) if (query !== null) gl.deleteQuery(query);
			byVariant[name] = passes
				.map((pass, index) => (Array.isArray(pass) ? median(perPass[index]) : null))
				.filter((_, index) => Array.isArray(passes[index]))
				.map((value) => (value === null ? 'n/a' : value.toFixed(2)))
				.join(' / ') + (disjoint ? ' DISJOINT' : '');
		}
		results.configs[`antialias ${antialias ? 'on' : 'off'}, ${width}x${height}`] = byVariant;
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		canvas.remove();
	}
	return results;
}

await send('Runtime.enable');
const message = await send('Runtime.evaluate', {
	expression: `(${probe.toString()})(${options.configs}, ${JSON.stringify(VARIANTS)})`,
	awaitPromise: true,
	returnByValue: true,
});
if (message.result.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails));
const { renderer, configs, error } = message.result.result.value;
if (error) throw new Error(error);

// One markdown table, variants down, configs across: the decision record's shape.
const columns = Object.keys(configs);
console.log(`Device: ${renderer}. Median ms per timed pass, vsync on.\n`);
console.log(`| Timed passes in one frame | ${columns.join(' | ')} |`);
console.log(`|---|${columns.map(() => '---').join('|')}|`);
for (const variant of Object.keys(VARIANTS)) {
	console.log(`| ${variant} | ${columns.map((column) => configs[column][variant]).join(' | ')} |`);
}

socket.close();
chrome.kill();
process.exit(0);
