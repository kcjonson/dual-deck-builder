#!/usr/bin/env node
// Serves a built directory over plain HTTP the way the playtest host does: no
// cross-origin isolation headers, unlike the dev server. The boot smoke's
// production project (playwright.config.ts) runs the shipped bundle on it.
//
// Usage: node scripts/serve-static.mjs <directory> <port>
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [directory, port] = process.argv.slice(2);
const root = resolve(directory ?? '');
if (!directory || !port || !existsSync(join(root, 'index.html'))) {
	console.error(`serve-static: ${root} has no index.html; run "npm run build:web" first.`);
	process.exit(1);
}

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.css': 'text/css',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.ttf': 'font/ttf',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
	'.map': 'application/json',
	'.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
	const path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
	let file = normalize(join(root, path));
	if (file !== root && !file.startsWith(root + sep)) {
		response.writeHead(403).end();
		return;
	}
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
	if (!existsSync(file)) {
		response.writeHead(404).end();
		return;
	}
	response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
	createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1', () => {
	console.log(`serve-static: ${root} on http://127.0.0.1:${port}`);
});
