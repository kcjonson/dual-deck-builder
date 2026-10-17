/**
 * Builds the UI art atlas (DDB-504; R5.19, R5.20, R5.31): every piece in
 * scripts/ui-art/pieces.mjs is rasterised from its SVG by Playwright's
 * Chromium, packed (MaxRects) into one 2048-wide RGBA page with its edges extruded
 * into a gutter (so linear filtering never samples a neighbour), and written
 * with the typed manifest components import.
 *
 *   node scripts/build-ui-art.mjs            write the atlas and manifest
 *   node scripts/build-ui-art.mjs --check    exit 1 when either differs from what is committed
 *
 * Output is byte-stable for a given Chromium build: no timestamps, seeded
 * noise, a fixed packing order, and a fixed PNG encoder setting. A different
 * Chromium or OS can anti-alias a stroke differently, so `--check` is a local
 * tool, not a CI gate; it ignores line endings in the manifest.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import pngjs from 'pngjs';
import { authorPieces } from './ui-art/pieces.mjs';

const { PNG } = pngjs;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const atlasPath = resolve(repoRoot, 'src/assets/ui-art/ui-art.png');
const manifestPath = resolve(repoRoot, 'src/renderer/game/art/uiArtManifest.ts');
const fontPath = resolve(repoRoot, 'src/assets/fonts/barlow-condensed/BarlowCondensed-SemiBold.ttf');

const ATLAS_WIDTH = 2048;
const MAX_HEIGHT = 2048;
/** Texels between pieces, each piece extruding half of it. */
const GUTTER = 4;
const EXTRUDE = GUTTER / 2;

const check = process.argv.includes('--check');

function page(svg, font) {
	return '<!doctype html><html><head><meta charset="utf-8"><style>'
		+ `@font-face { font-family: 'Barlow Condensed'; font-weight: 600; src: url(data:font/ttf;base64,${font}) format('truetype'); }`
		+ 'html, body { margin: 0; padding: 0; background: transparent; } svg { display: block; }'
		+ `</style></head><body>${svg}</body></html>`;
}

async function rasterise(pieces) {
	const font = readFileSync(fontPath).toString('base64');
	const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] });
	try {
		const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1600, height: 800 } });
		const tab = await context.newPage();
		const out = new Map();
		for (const piece of pieces) {
			await tab.setViewportSize({ width: Math.max(piece.width, 16), height: Math.max(piece.height, 16) });
			await tab.setContent(page(piece.svg, font), { waitUntil: 'load' });
			await tab.evaluate(async () => {
				await document.fonts.load("600 40px 'Barlow Condensed'");
				await document.fonts.ready;
			});
			const buffer = await tab.screenshot({ clip: { x: 0, y: 0, width: piece.width, height: piece.height }, omitBackground: true, type: 'png' });
			const image = PNG.sync.read(buffer);
			if (image.width !== piece.width || image.height !== piece.height) {
				throw new Error(`${piece.name}: rendered ${image.width}x${image.height}, authored ${piece.width}x${piece.height}`);
			}
			out.set(piece.name, image);
		}
		return out;
	} finally {
		await browser.close();
	}
}

/**
 * MaxRects packing, best short side fit (Jylanki's), largest pieces first
 * and ties by name, so the layout never depends on authoring order. Shelves
 * left a strip as tall as the 2x logo empty beside it; this fills it.
 */
function pack(pieces) {
	const order = [...pieces].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height)
		|| b.width * b.height - a.width * a.height || a.name.localeCompare(b.name));
	let free = [{ x: 0, y: 0, width: ATLAS_WIDTH, height: MAX_HEIGHT }];
	const placed = new Map();
	let used = 0;
	for (const piece of order) {
		const width = piece.width + GUTTER;
		const height = piece.height + GUTTER;
		let best = null;
		let bestShort = Infinity;
		let bestLong = Infinity;
		for (const rect of free) {
			if (rect.width < width || rect.height < height) continue;
			const short = Math.min(rect.width - width, rect.height - height);
			const long = Math.max(rect.width - width, rect.height - height);
			if (short < bestShort || (short === bestShort && long < bestLong)) {
				best = rect;
				bestShort = short;
				bestLong = long;
			}
		}
		if (!best) throw new Error(`${piece.name} does not fit on one ${ATLAS_WIDTH}x${MAX_HEIGHT} page`);
		const cell = { x: best.x, y: best.y, width, height };
		placed.set(piece.name, { x: cell.x + EXTRUDE, y: cell.y + EXTRUDE });
		used = Math.max(used, cell.y + height);
		free = splitFree(free, cell);
	}
	let height = 256;
	while (height < used) height *= 2;
	return { placed, height };
}

/** Every free rect the cell overlaps, split into the parts it leaves, then any rect inside another dropped. */
function splitFree(free, cell) {
	const next = [];
	for (const rect of free) {
		const overlaps = cell.x < rect.x + rect.width && rect.x < cell.x + cell.width && cell.y < rect.y + rect.height && rect.y < cell.y + cell.height;
		if (!overlaps) {
			next.push(rect);
			continue;
		}
		if (cell.x > rect.x) next.push({ x: rect.x, y: rect.y, width: cell.x - rect.x, height: rect.height });
		if (cell.x + cell.width < rect.x + rect.width) next.push({ x: cell.x + cell.width, y: rect.y, width: rect.x + rect.width - cell.x - cell.width, height: rect.height });
		if (cell.y > rect.y) next.push({ x: rect.x, y: rect.y, width: rect.width, height: cell.y - rect.y });
		if (cell.y + cell.height < rect.y + rect.height) next.push({ x: rect.x, y: cell.y + cell.height, width: rect.width, height: rect.y + rect.height - cell.y - cell.height });
	}
	return next.filter((rect, index) => !next.some((other, otherIndex) => otherIndex !== index
		&& rect.x >= other.x && rect.y >= other.y && rect.x + rect.width <= other.x + other.width && rect.y + rect.height <= other.y + other.height
		&& (otherIndex < index || rect.width !== other.width || rect.height !== other.height || rect.x !== other.x || rect.y !== other.y)));
}

/** Copies a piece into the page and repeats its outermost texels across the gutter. */
function blit(target, image, at) {
	for (let row = -EXTRUDE; row < image.height + EXTRUDE; row++) {
		const sourceRow = Math.min(image.height - 1, Math.max(0, row));
		for (let column = -EXTRUDE; column < image.width + EXTRUDE; column++) {
			const sourceColumn = Math.min(image.width - 1, Math.max(0, column));
			const from = (sourceRow * image.width + sourceColumn) * 4;
			const to = ((at.y + row) * target.width + at.x + column) * 4;
			target.data[to] = image.data[from];
			target.data[to + 1] = image.data[from + 1];
			target.data[to + 2] = image.data[from + 2];
			target.data[to + 3] = image.data[from + 3];
		}
	}
}

function manifestSource(pieces, placed, height) {
	const rows = [...pieces]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((piece) => {
			const { x, y } = placed.get(piece.name);
			const density = piece.slice?.scale ? `, scale: ${piece.slice.scale}` : '';
			const slice = piece.slice
				? `, slice: { top: ${piece.slice.top}, right: ${piece.slice.right}, bottom: ${piece.slice.bottom}, left: ${piece.slice.left}${density} }`
				: '';
			const ground = piece.ground ? `, ground: '${piece.ground}'` : '';
			return `\t\t${piece.name}: { x: ${x}, y: ${y}, width: ${piece.width}, height: ${piece.height}, scale: ${piece.scale}, tint: '${piece.tint}'${slice}${ground} },`;
		});
	return [
		'/**',
		' * Generated by scripts/build-ui-art.mjs from scripts/ui-art/pieces.mjs; do not edit.',
		' *',
		' * The UI art atlas (src/assets/ui-art/ui-art.png): each piece\'s rect in',
		' * texture pixels, its raster scale, what its tint multiplies (R5.18), and',
		' * R5.19\'s nine-slice insets where it has them.',
		' */',
		"import type { ArtAtlasManifest } from '../../engine/draw/artAtlas';",
		'',
		'export const UI_ART_MANIFEST = {',
		`\twidth: ${ATLAS_WIDTH},`,
		`\theight: ${height},`,
		'\tpieces: {',
		...rows,
		'\t},',
		'} as const satisfies ArtAtlasManifest;',
		'',
		'export type UiArtName = keyof typeof UI_ART_MANIFEST.pieces;',
		'',
	].join('\n');
}

async function main() {
	const pieces = authorPieces(repoRoot);
	const names = new Set();
	for (const piece of pieces) {
		if (names.has(piece.name)) throw new Error(`${piece.name} is authored twice`);
		names.add(piece.name);
	}
	const images = await rasterise(pieces);
	const { placed, height } = pack(pieces);
	const atlas = new PNG({ width: ATLAS_WIDTH, height });
	atlas.data.fill(0);
	for (const piece of pieces) blit(atlas, images.get(piece.name), placed.get(piece.name));
	const png = PNG.sync.write(atlas, { colorType: 6, deflateLevel: 9, deflateStrategy: 3, filterType: -1 });
	const manifest = manifestSource(pieces, placed, height);

	if (check) {
		const stale = [];
		if (!existsSync(atlasPath) || !readFileSync(atlasPath).equals(png)) stale.push(atlasPath);
		// A Windows checkout with autocrlf has CRLF in the manifest; the content is what matters.
		const committed = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n') : null;
		if (committed !== manifest) stale.push(manifestPath);
		if (stale.length > 0) {
			console.error(`UI art is stale; run node scripts/build-ui-art.mjs:\n${stale.join('\n')}`);
			process.exit(1);
		}
		console.log('UI art is up to date.');
		return;
	}
	mkdirSync(dirname(atlasPath), { recursive: true });
	writeFileSync(atlasPath, png);
	writeFileSync(manifestPath, manifest);
	console.log(`UI art: ${pieces.length} pieces on one ${ATLAS_WIDTH}x${height} page (${png.length} bytes).`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
