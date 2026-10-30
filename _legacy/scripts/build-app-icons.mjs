/**
 * Renders the small mark (docs/design/ui-art-direction/mark.svg) into the
 * app icon set: build/icon.ico, build/icon.icns and build/icon.png for
 * electron-builder, and public/favicon.ico for the web build. Sizes up to
 * 48 px use mark-small.svg (no shadow, heavier strokes); larger ones use the
 * full mark. Rasterised in the Chromium that Playwright already installs, and
 * the ICO and ICNS containers are written by hand (both just wrap PNGs), so
 * there is no new dependency.
 *
 *   node scripts/build-app-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markDir = resolve(repoRoot, 'docs/design/ui-art-direction');
const buildDir = resolve(repoRoot, 'build');
const publicDir = resolve(repoRoot, 'public');

const SMALL_VARIANT_MAX = 48;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const FAVICON_SIZES = [16, 32, 48];
const ICNS_TYPES = new Map([
	[16, 'icp4'],
	[32, 'icp5'],
	[64, 'icp6'],
	[128, 'ic07'],
	[256, 'ic08'],
	[512, 'ic09'],
	[1024, 'ic10'],
]);
const ELECTRON_PNG_SIZE = 512;

/** The mark is 140x156; icons are square, so widen the viewBox and centre it. */
function squareSvg(file) {
	const svg = readFileSync(resolve(markDir, file), 'utf8');
	const squared = svg.replace('viewBox="0 0 140 156"', 'viewBox="-8 0 156 156"');
	if (squared === svg) throw new Error(`${file}: viewBox not found`);
	return squared;
}

async function renderAll(sizes) {
	const full = squareSvg('mark.svg');
	const small = squareSvg('mark-small.svg');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ deviceScaleFactor: 1 });
		const out = new Map();
		for (const size of [...new Set(sizes)].sort((a, b) => a - b)) {
			const svg = size <= SMALL_VARIANT_MAX ? small : full;
			const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
			await page.setViewportSize({ width: size, height: size });
			await page.setContent(
				`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${src}">`,
			);
			await page.waitForFunction(() => document.images[0].complete);
			out.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
		}
		return out;
	} finally {
		await browser.close();
	}
}

function buildIco(pngs, sizes) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(sizes.length, 4);
	const entries = [];
	const images = [];
	let offset = 6 + 16 * sizes.length;
	for (const size of sizes) {
		const png = pngs.get(size);
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size >= 256 ? 0 : size, 0);
		entry.writeUInt8(size >= 256 ? 0 : size, 1);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		entries.push(entry);
		images.push(png);
		offset += png.length;
	}
	return Buffer.concat([header, ...entries, ...images]);
}

function buildIcns(pngs) {
	const chunks = [];
	for (const [size, type] of ICNS_TYPES) {
		const png = pngs.get(size);
		const head = Buffer.alloc(8);
		head.write(type, 0, 'ascii');
		head.writeUInt32BE(png.length + 8, 4);
		chunks.push(head, png);
	}
	const body = Buffer.concat(chunks);
	const head = Buffer.alloc(8);
	head.write('icns', 0, 'ascii');
	head.writeUInt32BE(body.length + 8, 4);
	return Buffer.concat([head, body]);
}

const pngs = await renderAll([...ICO_SIZES, ...FAVICON_SIZES, ...ICNS_TYPES.keys(), ELECTRON_PNG_SIZE]);

mkdirSync(buildDir, { recursive: true });
writeFileSync(resolve(buildDir, 'icon.png'), pngs.get(ELECTRON_PNG_SIZE));
writeFileSync(resolve(buildDir, 'icon.ico'), buildIco(pngs, ICO_SIZES));
writeFileSync(resolve(buildDir, 'icon.icns'), buildIcns(pngs));
writeFileSync(resolve(publicDir, 'favicon.ico'), buildIco(pngs, FAVICON_SIZES));
console.log('wrote build/icon.{png,ico,icns} and public/favicon.ico');
