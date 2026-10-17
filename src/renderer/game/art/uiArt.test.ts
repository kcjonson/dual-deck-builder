import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ArtPiece, validateArtAtlas } from '../../engine/draw/artAtlas';
import { DrawApi } from '../../engine/draw/DrawApi';
import { RecordingBackend } from '../../engine/draw/RecordingBackend';
import type { ImageCommand, RectCommand } from '../../engine/draw/commands';
import { resolveColor } from '../../engine/style/styleObject';
import { UI_ART_ATLAS, drawUiArt, loadUiArt, uiArtPiece, uiArtSize } from './uiArt';
import { UI_ART_MANIFEST, UiArtName } from './uiArtManifest';

const ATLAS = PNG.sync.read(readFileSync(resolve(__dirname, '../../../assets/ui-art/ui-art.png')));
const PIECES = UI_ART_MANIFEST.pieces;
const NAMES = Object.keys(PIECES) as UiArtName[];

function texel(x: number, y: number): [number, number, number, number] {
	const at = (y * ATLAS.width + x) * 4;
	return [ATLAS.data[at], ATLAS.data[at + 1], ATLAS.data[at + 2], ATLAS.data[at + 3]];
}

function luminance([r, g, b]: readonly number[]): number {
	const channel = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const INK = luminance(resolveColor('#23221F'));

describe('the UI art manifest (DDB-504)', () => {
	it('is a sound atlas', () => {
		expect(validateArtAtlas(UI_ART_MANIFEST)).toEqual([]);
	});

	it('matches the committed page, one 2048 page', () => {
		expect([ATLAS.width, ATLAS.height]).toEqual([UI_ART_MANIFEST.width, UI_ART_MANIFEST.height]);
		expect(ATLAS.width).toBeLessThanOrEqual(2048);
		expect(ATLAS.height).toBeLessThanOrEqual(2048);
	});

	// The spec's list (UI Art Direction, Building it) as names a component can count on.
	it.each([
		['paper W1, W2 and W3 in three variants', /^paper_w[123]_[abc]$/, 9],
		['tape strips', /^tape_[abc]$/, 3],
		['highlighter swipes', /^highlight_[a-d]$/, 4],
		['grease-pencil loops', /^loop_[a-d]$/, 4],
		['stamps', /^stamp_(looted|depleted|recon|hostile|lost|fallen)$/, 6],
		['card backs A and B at 1x and 2x', /^card_back_[ab](_2x)?$/, 4],
		['resource icons at 1x and 2x', /^icon_(food|water|fuel|scrap|meds|people)(_2x)?$/, 12],
		['the logo and the small mark at 1x and 2x', /^(logo|mark)(_2x)?$/, 4],
	])('has %s', (_label, pattern, count) => {
		expect(NAMES.filter((name) => pattern.test(name))).toHaveLength(count);
	});

	it('has the card edge, the cover, the fold, the deck glyph and the tag tear', () => {
		expect(NAMES).toEqual(expect.arrayContaining(['card_edge', 'atlas_cover', 'paper_fold', 'icon_deck', 'icon_deck_2x', 'tear_a']));
	});

	it('pairs every 2x piece with a 1x piece of half its size', () => {
		for (const name of NAMES.filter((candidate) => candidate.endsWith('_2x'))) {
			const one = PIECES[name.slice(0, -3) as UiArtName];
			expect(one.scale).toBe(1);
			expect(uiArtSize(name)).toEqual(uiArtSize(name.slice(0, -3) as UiArtName));
			expect(PIECES[name].scale).toBe(2);
		}
	});

	it('marks paper as surface-tinted and the resource icons as ink-tinted', () => {
		for (const name of NAMES) {
			const expected = /^paper_w/.test(name) ? 'surface' : /^icon_(?!deck)/.test(name) ? 'ink' : 'none';
			expect([name, PIECES[name].tint]).toEqual([name, expected]);
		}
	});
});

describe('the UI art page', () => {
	// Spec, Wear: the centre slice is flat so the shader's tint is the surface colour exactly.
	it.each(NAMES.filter((name) => PIECES[name].tint === 'surface'))('%s has a flat white, opaque centre', (name) => {
		const piece: ArtPiece = PIECES[name];
		const slice = piece.slice ?? { top: 0, right: 0, bottom: 0, left: 0 };
		for (let y = piece.y + slice.top; y < piece.y + piece.height - slice.bottom; y++) {
			for (let x = piece.x + slice.left; x < piece.x + piece.width - slice.right; x++) {
				const value = texel(x, y);
				if (value.some((channel) => channel !== 255)) throw new Error(`${name}: centre texel ${x - piece.x},${y - piece.y} is ${value.join(',')}`);
			}
		}
	});

	// A full-screen sheet stretches each edge slice about ten times along its
	// length, so every row of a top or bottom edge is one colour, and every
	// column of a side; a stretch then has nothing to streak.
	it.each(NAMES.filter((name) => /^(paper_w[23]|atlas_cover)/.test(name)))('%s has edge slices that are the same all along', (name) => {
		const piece: ArtPiece = PIECES[name];
		const slice = piece.slice ?? { top: 0, right: 0, bottom: 0, left: 0 };
		const worst = { delta: 0, at: '' };
		const compare = (x: number, y: number, rx: number, ry: number) => {
			const a = texel(piece.x + x, piece.y + y);
			const b = texel(piece.x + rx, piece.y + ry);
			const delta = Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
			if (delta > worst.delta) Object.assign(worst, { delta, at: `${x},${y}` });
		};
		const right = piece.width - slice.right;
		const bottom = piece.height - slice.bottom;
		for (let x = slice.left; x < right; x++) {
			for (let y = 0; y < slice.top; y++) compare(x, y, slice.left, y);
			for (let y = bottom; y < piece.height; y++) compare(x, y, slice.left, y);
		}
		for (let y = slice.top; y < bottom; y++) {
			for (let x = 0; x < slice.left; x++) compare(x, y, x, slice.top);
			for (let x = right; x < piece.width; x++) compare(x, y, x, slice.top);
		}
		expect(worst).toEqual({ delta: expect.any(Number), at: expect.any(String) });
		expect(worst.delta).toBeLessThanOrEqual(2);
	});

	// Spec, Wear: text holds 4.5:1 measured on the worn texture, tinted the way it
	// draws. W3's hero mark is the one place exempt: it sits in its corner, and
	// nothing is read there.
	const HERO: Partial<Record<UiArtName, 'tr' | 'br' | 'bl'>> = { paper_w3_a: 'br', paper_w3_b: 'tr', paper_w3_c: 'bl' };
	it.each(NAMES.filter((name) => PIECES[name].tint === 'surface'))('ink holds 4.5:1 on every opaque texel of %s', (name) => {
		const piece: ArtPiece = PIECES[name];
		const tint = resolveColor(/^paper_w1/.test(name) ? '#F4EEDD' : '#EEE7D2');
		const corner = HERO[name.replace(/_2x$/, '') as UiArtName];
		const inset = piece.slice?.top ?? 0;
		let worst = Infinity;
		for (let y = 0; y < piece.height; y++) {
			for (let x = 0; x < piece.width; x++) {
				if (corner) {
					const inColumn = corner[1] === 'r' ? x >= piece.width - inset : x < inset;
					const inRow = corner[0] === 'b' ? y >= piece.height - inset : y < inset;
					if (inColumn && inRow) continue;
				}
				const [r, g, b, a] = texel(piece.x + x, piece.y + y);
				if (a < 250) continue;
				const shade = luminance([(r / 255) * tint[0], (g / 255) * tint[1], (b / 255) * tint[2]]);
				worst = Math.min(worst, (shade + 0.05) / (INK + 0.05));
			}
		}
		expect(worst).toBeGreaterThanOrEqual(4.5);
	});
});

describe('loadUiArt and drawUiArt', () => {
	it('loads the page under its name, checked against the manifest', async () => {
		const image = { naturalWidth: UI_ART_MANIFEST.width, naturalHeight: UI_ART_MANIFEST.height };
		await expect(loadUiArt({ loadImage: async () => image })).resolves.toEqual({
			name: UI_ART_ATLAS,
			image,
			width: UI_ART_MANIFEST.width,
			height: UI_ART_MANIFEST.height,
		});
	});

	it('falls back to flat paper when the page is not resident, and draws no marks', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		const sheet = resolveColor('#EEE7D2');
		const rect = { x: 0, y: 0, width: 400, height: 300 };
		api.beginFrame({ viewport: { width: 640, height: 480 } });
		expect(drawUiArt(api, { name: 'paper_w2_a', rect, tint: sheet })).toBe(false);
		expect(drawUiArt(api, { name: 'atlas_cover', rect })).toBe(false);
		expect(drawUiArt(api, { name: 'icon_water', rect: { x: 0, y: 0, width: 18, height: 18 }, tint: sheet })).toBe(false);
		api.endFrame();
		expect(backend.commands.map((command) => [command.kind, (command as RectCommand).fill])).toEqual([
			['rect', sheet],
			['rect', resolveColor('#EEE7D2')],
		]);
	});

	it('draws a piece from the resident page, nine-sliced', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		const texture = api.createTexture({ width: UI_ART_MANIFEST.width, height: UI_ART_MANIFEST.height });
		api.loadArtAtlas({ name: UI_ART_ATLAS, texture });
		api.beginFrame({ viewport: { width: 640, height: 480 } });
		expect(drawUiArt(api, { name: 'paper_w2_a', rect: { x: 0, y: 0, width: 400, height: 300 }, tint: resolveColor('#EEE7D2') })).toBe(true);
		api.endFrame();
		const [command] = backend.commands as ImageCommand[];
		const piece = PIECES.paper_w2_a;
		expect(command).toMatchObject({ texture, sourceRect: { x: piece.x, y: piece.y, width: piece.width, height: piece.height }, slice: piece.slice });
	});

	it('draws the 2x raster at a ratio above 1, its corners at their 1x size', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		const texture = api.createTexture({ width: UI_ART_MANIFEST.width, height: UI_ART_MANIFEST.height });
		api.loadArtAtlas({ name: UI_ART_ATLAS, texture });
		api.beginFrame({ viewport: { width: 640, height: 480 }, ratio: 2 });
		drawUiArt(api, { name: 'paper_w2_a', rect: { x: 0, y: 0, width: 400, height: 300 } });
		drawUiArt(api, { name: 'stamp_looted', rect: { x: 0, y: 0, ...uiArtSize('stamp_looted') } });
		api.endFrame();
		const [paper, stamp] = backend.commands as ImageCommand[];
		const dense = PIECES.paper_w2_a_2x;
		expect(paper.sourceRect).toEqual({ x: dense.x, y: dense.y, width: dense.width, height: dense.height });
		expect(paper.slice).toEqual({ top: 192, right: 192, bottom: 192, left: 192, scale: 2 });
		// A piece with no 2x raster draws its 1x one.
		expect(stamp.sourceRect).toMatchObject({ x: PIECES.stamp_looted.x, y: PIECES.stamp_looted.y });
		expect(uiArtPiece('stamp_looted', 2)).toBe(PIECES.stamp_looted);
	});
});
