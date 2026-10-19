/**
 * The UI art atlas's pieces (DDB-504), each authored as SVG at the size it is
 * packed. Geometry and colours are lifted from the canvas sources in
 * docs/design/ui-art-direction/canvas/ (WearStandards, Materials, FinalSplash,
 * FinalLogo, FinalCompound); the spec is docs/specs/UI Art Direction.md.
 *
 * A piece is { name, width, height, svg, scale, tint, slice?, ground? }:
 * - `scale` 2 marks a 2x raster of a 1x piece; it draws at width / 2. Every
 *   sliced piece has one, since the full-screen sheet is the main use and a
 *   1x corner is soft at a device pixel ratio of 2.
 * - `tint` says what the draw multiplies it by (R5.18). `surface` pieces are
 *   white paper with the wear multiplied in, so the shader's tint is the
 *   paper token and the centre slice comes out exactly that colour. `ink`
 *   pieces are white coverage for an ink colour. `none` is baked colour.
 * - `slice` is R5.19's insets in texture pixels, with `scale` beside them on
 *   a 2x piece so its corners draw at their 1x size.
 * - `ground` is the flat colour of a baked surface piece, which a draw falls
 *   back to when the page is not resident; a `surface` piece uses its tint.
 *
 * Every random choice comes from a PRNG seeded by the piece's name, and every
 * feTurbulence has a fixed seed, so a rebuild draws the same pixels.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const PALETTE = {
	ink: '#23221F',
	sheet: '#EEE7D2',
	paper: '#F4EEDD',
	freshPaper: '#F6F1E4',
	highway: '#D86036',
	casing: '#682C1E',
	routeTeal: '#4FA6A3',
	routeCasing: '#1F6E6A',
	stronghold: '#A3221B',
	highlighter: '#F4DA4C',
	grease: '#C8372D',
	tape: '#85837D',
	grime: '#6B4A22',
	char: '#1A1208',
	cardEdge: '#E9E1CB',
	looted: '#9A4F2E',
	recon: '#2F4A86',
};

/** Deterministic PRNG (mulberry32) keyed by a string. */
export function random(key) {
	let state = 2166136261;
	for (let index = 0; index < key.length; index++) state = Math.imul(state ^ key.charCodeAt(index), 16777619);
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const round = (value) => Math.round(value * 100) / 100;
const points = (list) => list.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

function svg(width, height, body, viewBox = `0 0 ${width} ${height}`) {
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${viewBox}">${body}</svg>`;
}

/** A smooth closed or open path through points (Catmull-Rom as cubic Beziers). */
function smoothPath(list, closed = false) {
	const count = list.length;
	const at = (index) => (closed ? list[(index + count) % count] : list[Math.max(0, Math.min(count - 1, index))]);
	let path = `M${round(list[0][0])} ${round(list[0][1])}`;
	const last = closed ? count : count - 1;
	for (let index = 0; index < last; index++) {
		const p0 = at(index - 1);
		const p1 = at(index);
		const p2 = at(index + 1);
		const p3 = at(index + 2);
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		path += ` C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
	}
	return closed ? `${path} Z` : path;
}

// -- paper ------------------------------------------------------------------

/**
 * The paper outline: straight edges, with jagged shallow tears only inside
 * the named corners' slices, so an edge slice stays the same all along the
 * axis it stretches on. `tears` maps a corner (tl, tr, br, bl) to a depth.
 */
function paperOutline({ width, height, inset, tears, rng }) {
	const notch = (from, to, depth, inward) => {
		const out = [];
		const steps = 4 + Math.floor(rng() * 3);
		for (let step = 1; step < steps; step++) {
			const t = step / steps;
			const jag = step % 2 === 1 ? depth * (0.45 + rng() * 0.55) : depth * rng() * 0.35;
			out.push([from[0] + (to[0] - from[0]) * t + inward[0] * jag, from[1] + (to[1] - from[1]) * t + inward[1] * jag]);
		}
		return out;
	};
	// A tear spans part of the corner slice on one of its two edges.
	const span = (start) => [start, start + inset * (0.35 + rng() * 0.3)];
	const outline = [[0, 0]];
	const top = tears.tr ? span(width - inset * 0.85) : null;
	if (tears.tl) {
		const [a, b] = span(inset * 0.15);
		outline.push([a, 0], ...notch([a, 0], [b, 0], tears.tl, [0, 1]), [b, 0]);
	}
	if (top) outline.push([top[0], 0], ...notch([top[0], 0], [top[1], 0], tears.tr, [0, 1]), [top[1], 0]);
	outline.push([width, 0]);
	if (tears.br) {
		const [a, b] = span(height - inset * 0.85);
		outline.push([width, a], ...notch([width, a], [width, b], tears.br, [-1, 0]), [width, b]);
	}
	outline.push([width, height]);
	if (tears.bl) {
		const [a, b] = span(inset * 0.15);
		outline.push([b, height], ...notch([b, height], [a, height], tears.bl, [0, -1]), [a, height]);
	}
	outline.push([0, height]);
	return outline;
}

/** The edge band (spec, Wear): full grime to `band`, gone by `band + falloff`. */
function edgeBandMask({ id, width, height, band, falloff }) {
	const inset = band + falloff / 2;
	return `<filter id="${id}Blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${round(falloff / 6)}"/></filter>`
		+ `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`
		+ `<rect width="${width}" height="${height}" fill="#fff"/>`
		+ `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="#000" filter="url(#${id}Blur)"/>`
		+ '</mask>';
}

/**
 * Where the mottle may go: the corners, fading to nothing by `inset`, which is
 * where the edge slices start. An edge slice is stretched along its length,
 * up to ten times on a full-screen sheet, so it carries only the band's tone,
 * the same at every point along it, and a stretch cannot streak it.
 */
function cornerMask({ id, width, height, inset }) {
	const corners = [[0, 0], [width, 0], [width, height], [0, height]];
	return `<radialGradient id="${id}Fade" cx="0.5" cy="0.5" r="0.5">`
		+ '<stop offset="0" stop-color="#fff"/><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
		+ `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`
		+ corners.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="${inset}" fill="url(#${id}Fade)"/>`).join('')
		+ '</mask>';
}

/** The band's even tone, the average of the mottle, so an edge slice reads as the same paper as its corners. */
function bandTone(width, height, opacity) {
	return `<rect width="${width}" height="${height}" fill="#66472A" opacity="${opacity}" mask="url(#band)"/>`;
}

/**
 * WearStandards' wsGrime, reseeded, with its alpha scaled by `strength`: the
 * mock's full strength takes ink on Sheet below 4.5:1 at the darkest blot, and
 * the spec measures contrast on the worn texture, not the flat colour.
 * `specks` swaps the mid mottle for wsGrimeHeavy's fine specks (W3).
 */
function grimeFilter(id, seed, { strength = 1, specks = false, frequency = 0.014 } = {}) {
	const alpha = (scale, offset) => `${round(scale * strength)} 0 0 0 ${round(offset * strength)}`;
	const stain = `0 0 0 0 0.40  0 0 0 0 0.28  0 0 0 0 0.13  ${alpha(1.4, -0.62)}`;
	const second = specks
		? `<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seed + 3}" result="fine"/>`
			+ '<feColorMatrix in="fine" type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.11  0 0 0 0 0.07  5 0 0 0 -3.6" result="dots"/>'
			// Faded to grit: a full-strength speck is ink-dark, and text may pass over the band.
			+ '<feComponentTransfer in="dots" result="specks"><feFuncA type="linear" slope="0.25"/></feComponentTransfer>'
		: `<feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="${seed + 3}" result="mid"/>`
			+ `<feColorMatrix in="mid" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.17  ${alpha(0.5, -0.18)}" result="specks"/>`;
	return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
		+ `<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="4" seed="${seed}" result="big"/>`
		+ `<feColorMatrix in="big" type="matrix" values="${stain}" result="stain"/>`
		+ second
		+ '<feMerge><feMergeNode in="specks"/><feMergeNode in="stain"/></feMerge></filter>';
}

const BLEED = (id, seed) => `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%">`
	+ `<feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="${seed}" result="t"/>`
	+ '<feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter>';

const BLUR = (id, deviation) => `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${deviation}"/></filter>`;

/** A tide-line stain tucked into one corner, after WearStandards' margin stain. */
function cornerStain({ corner, width, height, size, rng }) {
	const [sx, sy] = { tl: [1, 1], tr: [-1, 1], br: [-1, -1], bl: [1, -1] }[corner];
	const ox = sx > 0 ? 0 : width;
	const oy = sy > 0 ? 0 : height;
	const reach = size * (0.75 + rng() * 0.2);
	const lift = size * (0.3 + rng() * 0.15);
	const d = `M${ox + sx * reach} ${oy} C ${ox + sx * reach * 0.9} ${oy + sy * lift}, ${ox + sx * lift} ${oy + sy * reach * 0.85}, ${ox} ${oy + sy * reach} L ${ox} ${oy} Z`;
	return `<path d="${d}" fill="#8A6A3A" fill-opacity="0.1" stroke="${PALETTE.grime}" stroke-width="1.6" stroke-opacity="0.16" filter="url(#bleed)"/>`;
}

const PAPER_VARIANTS = ['a', 'b', 'c'];
const STRENGTH_W2 = 0.55;
const STRENGTH_W3 = 0.54;
/**
 * Texels of edge slice between a W2 or W3 piece's corners. The edge is the
 * same all along its length (`cornerMask`), so a few texels stretch to any
 * sheet without streaking, and a surface barely larger than two corners
 * never squeezes it.
 */
const EDGE_SPAN = 8;

/**
 * W1, handled: a soft edge tone and one smudge at the grab corner, no
 * surface texture. The smudge sits wholly in the bottom-right corner slice.
 */
function paperW1(variant, index) {
	const rng = random(`paper_w1_${variant}`);
	const size = 72;
	const slice = { top: 16, right: 48, bottom: 48, left: 16 };
	const cx = size - 20 - rng() * 4;
	const cy = size - 14 - rng() * 4;
	const body = '<defs>'
		+ edgeBandMask({ id: 'band', width: size, height: size, band: 3, falloff: 12 })
		+ BLUR('smudge', 3)
		+ '</defs>'
		+ `<rect width="${size}" height="${size}" fill="#fff"/>`
		+ `<rect width="${size}" height="${size}" fill="${PALETTE.grime}" opacity="${0.15 + index * 0.02}" mask="url(#band)"/>`
		+ `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${11 + index}" ry="${5 + rng() * 2}" transform="rotate(${round(-20 + rng() * 30)} ${round(cx)} ${round(cy)})" fill="#2A1E12" opacity="${0.11 + rng() * 0.04}" filter="url(#smudge)"/>`;
	return { name: `paper_w1_${variant}`, width: size, height: size, svg: svg(size, size, body), slice, tint: 'surface', scale: 1 };
}

const W2_TEARS = [{ tr: 7 }, { bl: 6, tl: 4 }, { br: 8 }];
const W2_STAINS = ['br', 'tl', 'bl'];

/** W2, worn: aged edge-band grime, shallow tears, and a margin stain, the marks all inside the 96 px corner slices. */
function paperW2(variant, index) {
	const rng = random(`paper_w2_${variant}`);
	const size = 96 * 2 + EDGE_SPAN;
	const inset = 96;
	const outline = paperOutline({ width: size, height: size, inset, tears: W2_TEARS[index], rng });
	const body = '<defs>'
		+ edgeBandMask({ id: 'band', width: size, height: size, band: 24, falloff: 48 })
		+ cornerMask({ id: 'corners', width: size, height: size, inset })
		+ grimeFilter('grime', 17 + index * 11, { strength: STRENGTH_W2 })
		+ BLEED('bleed', 9 + index)
		+ `<clipPath id="outline"><polygon points="${points(outline)}"/></clipPath>`
		+ '</defs>'
		+ '<g clip-path="url(#outline)">'
		+ `<rect width="${size}" height="${size}" fill="#fff"/>`
		+ `<rect width="${size}" height="${size}" fill="${PALETTE.grime}" opacity="0.12" mask="url(#band)"/>`
		+ bandTone(size, size, 0.06)
		+ `<g mask="url(#corners)"><rect width="${size}" height="${size}" filter="url(#grime)" mask="url(#band)" style="mix-blend-mode: multiply"/></g>`
		+ cornerStain({ corner: W2_STAINS[index], width: size, height: size, size: 70, rng })
		+ '</g>';
	return { name: `paper_w2_${variant}`, width: size, height: size, svg: svg(size, size, body), slice: { top: inset, right: inset, bottom: inset, left: inset }, tint: 'surface', scale: 1 };
}

/**
 * W3, damaged: W2's wear, heavier, plus one hero mark in a corner slice: a
 * burnt corner, a bullet hole, or a ripped corner. The spec's stamp is the
 * fourth kind and is its own piece, drawn over any paper.
 */
function paperW3(variant, index) {
	const rng = random(`paper_w3_${variant}`);
	const size = 128 * 2 + EDGE_SPAN;
	const inset = 128;
	const tears = [{ tl: 5 }, { bl: 6 }, { tr: 6 }][index];
	const outline = paperOutline({ width: size, height: size, inset, tears, rng });
	const replaceCorner = (corner, edge) => {
		const at = outline.findIndex(([x, y]) => x === corner[0] && y === corner[1]);
		outline.splice(at, 1, ...edge);
	};
	let hero = '';
	let hole = '';
	if (variant === 'a') {
		// Burnt corner, bottom right: the paper is gone past a ragged char line.
		const edge = [];
		for (let step = 0; step <= 8; step++) {
			const angle = (Math.PI / 2) * (1 - step / 8);
			const radius = 70 + rng() * 16;
			edge.push([size - Math.cos(angle) * radius * 1.15, size - Math.sin(angle) * radius]);
		}
		edge[0] = [size, edge[0][1]];
		edge[8] = [edge[8][0], size];
		replaceCorner([size, size], edge);
		hero = `<path d="${smoothPath(edge)}" fill="none" stroke="${PALETTE.char}" stroke-width="5" stroke-opacity="0.85" filter="url(#charBlur)"/>`
			+ `<circle cx="${size}" cy="${size}" r="124" fill="url(#scorch)"/>`;
	} else if (variant === 'b') {
		// A bullet hole near the top right, with a scorched ring.
		const hx = round(size - 40 - rng() * 12);
		const hy = round(38 + rng() * 12);
		hero = `<circle cx="${hx}" cy="${hy}" r="14" fill="#3A2510" opacity="0.4" filter="url(#ring)"/>`
			+ `<circle cx="${hx}" cy="${hy}" r="7.5" fill="${PALETTE.char}" opacity="0.7"/>`;
		hole = ` M${hx + 5} ${hy} A5 5 0 1 0 ${hx - 5} ${hy} A5 5 0 1 0 ${hx + 5} ${hy} Z`;
	} else {
		// A ripped corner, bottom left: a diagonal tear with a soft shadowed lip.
		const tear = [];
		for (let step = 0; step <= 10; step++) {
			const t = step / 10;
			tear.push([104 * (1 - t) + (rng() - 0.5) * 6, size - 92 * t + (rng() - 0.5) * 6]);
		}
		tear[0] = [104, size];
		tear[10] = [0, size - 92];
		replaceCorner([0, size], tear);
		hero = `<polyline points="${points(tear)}" fill="none" stroke="#3A2A14" stroke-width="3" stroke-opacity="0.35" filter="url(#charBlur)"/>`;
	}
	const clip = `<path clip-rule="evenodd" d="M${points(outline).split(' ').join(' L')} Z${hole}"/>`;
	const body = '<defs>'
		+ edgeBandMask({ id: 'band', width: size, height: size, band: 28, falloff: 56 })
		+ cornerMask({ id: 'corners', width: size, height: size, inset })
		+ grimeFilter('grime', [3, 29, 41][index], { strength: STRENGTH_W3, specks: true, frequency: 0.012 })
		+ BLEED('bleed', 5 + index)
		+ BLUR('charBlur', 1.6)
		+ BLUR('ring', 5)
		+ '<radialGradient id="scorch" cx="0.5" cy="0.5" r="0.5">'
		+ `<stop offset="0" stop-color="${PALETTE.char}" stop-opacity="0.9"/><stop offset="0.45" stop-color="#3A2510" stop-opacity="0.55"/>`
		+ '<stop offset="0.75" stop-color="#6B4A22" stop-opacity="0.12"/><stop offset="1" stop-color="#6B4A22" stop-opacity="0"/></radialGradient>'
		+ `<clipPath id="outline">${clip}</clipPath>`
		+ '</defs>'
		+ '<g clip-path="url(#outline)">'
		+ `<rect width="${size}" height="${size}" fill="#fff"/>`
		+ `<rect width="${size}" height="${size}" fill="${PALETTE.grime}" opacity="0.12" mask="url(#band)"/>`
		+ bandTone(size, size, 0.08)
		+ `<g mask="url(#corners)"><rect width="${size}" height="${size}" filter="url(#grime)" mask="url(#band)" style="mix-blend-mode: multiply"/></g>`
		+ hero
		+ '</g>';
	return { name: `paper_w3_${variant}`, width: size, height: size, svg: svg(size, size, body), slice: { top: inset, right: inset, bottom: inset, left: inset }, tint: 'surface', scale: 1 };
}

/** A W2 crease: a tone change across the sheet (spec, Wear), drawn as a strip that stretches down its length. */
function paperFold() {
	const width = 24;
	const height = 16;
	const body = '<defs><linearGradient id="fold" x1="0" x2="1">'
		+ '<stop offset="0" stop-color="#3A2A14" stop-opacity="0"/><stop offset="0.46" stop-color="#3A2A14" stop-opacity="0.16"/>'
		+ '<stop offset="0.5" stop-color="#FFF6DC" stop-opacity="0.5"/><stop offset="0.56" stop-color="#3A2A14" stop-opacity="0.08"/>'
		+ '<stop offset="1" stop-color="#3A2A14" stop-opacity="0"/></linearGradient></defs>'
		+ `<rect width="${width}" height="${height}" fill="url(#fold)"/>`;
	return { name: 'paper_fold', width, height, svg: svg(width, height, body), tint: 'none', scale: 1 };
}

/**
 * The closed atlas on the splash (FinalSplash): the cover sheet with its
 * grime, the spine shadow on the left, the double neatline, and the page
 * edges stepping out to the right and bottom. Nine-sliced so it fits any
 * cover size; the centre is flat Sheet. Baked colour, because the spine's
 * highlight is lighter than the paper and a multiplied tint cannot lighten.
 */
function atlasCover() {
	const slice = { top: 80, right: 90, bottom: 90, left: 96 };
	// The page edges step 10 px out to the right and bottom, inside those insets.
	const sheetWidth = slice.left + EDGE_SPAN + slice.right - 10;
	const sheetHeight = slice.top + EDGE_SPAN + slice.bottom - 10;
	const width = sheetWidth + 10;
	const height = sheetHeight + 10;
	const line = (offset, stroke) => {
		const o = offset;
		return `<rect x="${o.left}" y="${o.top}" width="${sheetWidth - o.left - o.right}" height="${sheetHeight - o.top - o.bottom}" fill="none" stroke="${PALETTE.ink}" stroke-width="${stroke}"/>`;
	};
	const body = '<defs>'
		+ edgeBandMask({ id: 'band', width: sheetWidth, height: sheetHeight, band: 20, falloff: 48 })
		+ cornerMask({ id: 'corners', width: sheetWidth, height: sheetHeight, inset: 80 })
		+ grimeFilter('grime', 17, { strength: STRENGTH_W2, frequency: 0.012 })
		+ '</defs>'
		+ `<rect x="10" y="10" width="${sheetWidth}" height="${sheetHeight}" fill="${PALETTE.ink}"/>`
		+ `<rect x="9" y="9" width="${sheetWidth}" height="${sheetHeight}" fill="#C9BFA5"/>`
		+ `<rect x="6" y="6" width="${sheetWidth}" height="${sheetHeight}" fill="#D9D0B8"/>`
		+ `<rect width="${sheetWidth}" height="${sheetHeight}" fill="${PALETTE.sheet}"/>`
		+ bandTone(sheetWidth, sheetHeight, 0.06)
		+ `<g mask="url(#corners)"><rect width="${sheetWidth}" height="${sheetHeight}" filter="url(#grime)" mask="url(#band)" style="mix-blend-mode: multiply"/></g>`
		+ `<rect width="26" height="${sheetHeight}" fill="#3A2A14" opacity="0.12"/>`
		+ `<rect x="26" width="3" height="${sheetHeight}" fill="#FFF6DC" opacity="0.5"/>`
		+ line({ left: 44.3, top: 18.3, right: 18.3, bottom: 18.3 }, 0.6)
		+ line({ left: 52.8, top: 26.8, right: 26.8, bottom: 26.8 }, 1.6);
	return { name: 'atlas_cover', width, height, svg: svg(width, height, body), slice, tint: 'none', scale: 1, ground: PALETTE.sheet };
}

// -- tape and hand marks ----------------------------------------------------

/** Duct tape (Materials, WearStandards): grey, faint weave, torn ends. Drawn level; the component rotates it onto a corner. */
function tape(variant, index) {
	const rng = random(`tape_${variant}`);
	const width = [88, 104, 120][index];
	const height = 28;
	const left = [];
	const right = [];
	for (let step = 0; step <= 7; step++) {
		left.push([2 + rng() * 5, (step / 7) * height]);
		right.push([width - 2 - rng() * 5, (step / 7) * height]);
	}
	const outline = [...right, ...left.slice().reverse()];
	const body = '<defs>'
		+ `<clipPath id="strip"><polygon points="${points(outline)}"/></clipPath>`
		+ '<pattern id="weave" width="3" height="4" patternUnits="userSpaceOnUse"><rect width="1" height="4" fill="#fff" fill-opacity="0.09"/></pattern>'
		+ '<linearGradient id="sheen" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/>'
		+ '<stop offset="0.8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.14"/></linearGradient>'
		+ `<filter id="crinkle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.08 0.3" numOctaves="2" seed="${30 + index}"/>`
		+ '<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 -0.1"/></filter>'
		+ '</defs>'
		+ '<g clip-path="url(#strip)" opacity="0.94">'
		+ `<rect width="${width}" height="${height}" fill="${PALETTE.tape}"/>`
		+ `<rect width="${width}" height="${height}" fill="url(#weave)"/>`
		+ `<rect width="${width}" height="${height}" filter="url(#crinkle)"/>`
		+ `<rect width="${width}" height="${height}" fill="url(#sheen)"/>`
		+ '</g>';
	return { name: `tape_${variant}`, width, height, svg: svg(width, height, body), tint: 'none', scale: 1 };
}

/**
 * A highlighter swipe (Materials): a chisel-tip stroke, streaky along its
 * length, darker where the pen paused at the start. Normal blend, baked at
 * the tone it should read at, so the draw never needs `multiply` (R5.20,
 * R5.22a); the label is drawn after it. Three-sliced: the ends keep their
 * shape and the middle stretches to the row.
 */
function highlighter(variant, index) {
	const rng = random(`highlight_${variant}`);
	const width = 168;
	const height = 30;
	const end = 24;
	const top = [];
	const bottom = [];
	const steps = 12;
	const lean = (rng() - 0.5) * 3;
	for (let step = 0; step <= steps; step++) {
		const t = step / steps;
		const x = 6 + t * (width - 12);
		const middle = step > 0 && step < steps;
		top.push([x, 4 + lean * t + (middle ? (rng() - 0.5) * 1.6 : 2 + rng() * 2)]);
		bottom.push([x, height - 4 + lean * t + (middle ? (rng() - 0.5) * 1.6 : -2 - rng() * 2)]);
	}
	// Chisel ends, slanted the way a right hand drags the pen.
	top[0][0] += 3;
	bottom[steps][0] -= 3;
	const outline = [...top, ...bottom.slice().reverse()];
	const body = '<defs>'
		+ `<clipPath id="body"><path d="${smoothPath(outline, true)}"/></clipPath>`
		+ `<filter id="streaks" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.45" numOctaves="2" seed="${50 + index * 7}"/>`
		+ '<feColorMatrix type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.72  0 0 0 0 0.16  0 0 0 0.9 -0.32"/></filter>'
		+ BLUR('pool', 2)
		+ '</defs>'
		+ '<g clip-path="url(#body)">'
		+ `<rect width="${width}" height="${height}" fill="${PALETTE.highlighter}" opacity="0.62"/>`
		+ `<rect width="${width}" height="${height}" filter="url(#streaks)"/>`
		+ `<ellipse cx="${end * 0.45}" cy="${height / 2}" rx="${end * 0.5}" ry="${height / 2}" fill="#E8C93A" opacity="${0.22 + rng() * 0.1}" filter="url(#pool)"/>`
		+ '</g>';
	return { name: `highlight_${variant}`, width, height, svg: svg(width, height, body), slice: { top: 0, right: end, bottom: 0, left: end }, tint: 'none', scale: 1 };
}

/** A grease-pencil loop (Materials' "pick"): a waxy red ring that overshoots where it closes. */
function greaseLoop(variant, index) {
	const rng = random(`loop_${variant}`);
	const width = 220;
	const height = 150;
	const cx = width / 2;
	const cy = height / 2;
	const turns = variant === 'd' ? 1.85 : 1.08 + rng() * 0.12;
	const start = -Math.PI * (0.55 + rng() * 0.3);
	const list = [];
	const count = Math.round(14 * turns);
	for (let step = 0; step <= count; step++) {
		const t = step / count;
		const angle = start + t * turns * Math.PI * 2;
		const pass = variant === 'd' && t > 0.5 ? 0.92 : 1;
		const rx = (width / 2 - 14) * pass * (0.9 + rng() * 0.1) * (1 - 0.06 * t);
		const ry = (height / 2 - 14) * pass * (0.88 + rng() * 0.12);
		list.push([cx + Math.cos(angle) * rx + (index - 1.5) * 2, cy + Math.sin(angle) * ry]);
	}
	const body = '<defs>'
		+ `<filter id="wax" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${5 + index}" result="g"/>`
		+ '<feDisplacementMap in="SourceGraphic" in2="g" scale="3" xChannelSelector="R" yChannelSelector="G" result="d"/>'
		+ `<feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="${70 + index}" result="speck"/>`
		+ '<feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.9" result="mask"/>'
		+ '<feComposite in="d" in2="mask" operator="in"/></filter>'
		+ '</defs>'
		+ `<path d="${smoothPath(list)}" fill="none" stroke="${PALETTE.grease}" stroke-width="${4 + rng() * 0.8}" stroke-linecap="round" stroke-linejoin="round" filter="url(#wax)"/>`;
	return { name: `loop_${variant}`, width, height, svg: svg(width, height, body), tint: 'none', scale: 1 };
}

// -- stamps -----------------------------------------------------------------

const STAMP_FILTER = (seed) => `<filter id="stamp" x="-5%" y="-5%" width="110%" height="110%">`
	+ `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="${seed}" result="speck"/>`
	+ '<feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.75" result="mask"/>'
	+ '<feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>';

const STAMP_TEXT = 'font-family="Barlow Condensed" font-weight="600" text-anchor="middle"';

/** The rubber stamps (Materials): state that has happened, set at the tilt they were struck at. */
function stamps() {
	const make = (name, width, height, seed, inner) => ({
		name,
		width,
		height,
		svg: svg(width, height, `<defs>${STAMP_FILTER(seed)}</defs><g filter="url(#stamp)">${inner}</g>`),
		tint: 'none',
		scale: 1,
	});
	return [
		make('stamp_looted', 232, 110, 21, `<g transform="rotate(-8 116 55)" fill="none" stroke="${PALETTE.looted}">`
			+ '<rect x="16" y="22" width="200" height="66" rx="5" stroke-width="5"/>'
			+ `<text x="116" y="71" ${STAMP_TEXT} font-size="44" letter-spacing="5" fill="${PALETTE.looted}" stroke="none">LOOTED</text></g>`),
		make('stamp_depleted', 264, 100, 22, `<g transform="rotate(5 132 50)" fill="none" stroke="${PALETTE.ink}">`
			+ '<rect x="12" y="17" width="240" height="66" rx="5" stroke-width="5"/>'
			+ '<rect x="20" y="25" width="224" height="50" rx="3" stroke-width="1.6"/>'
			+ `<text x="132" y="66" ${STAMP_TEXT} font-size="40" letter-spacing="5" fill="${PALETTE.ink}" stroke="none">DEPLETED</text></g>`),
		make('stamp_recon', 140, 140, 23, `<g transform="rotate(-3 70 70)" fill="none" stroke="${PALETTE.recon}">`
			+ '<circle cx="70" cy="70" r="62" stroke-width="4"/><circle cx="70" cy="70" r="50" stroke-width="1.6"/>'
			+ '<path d="M34 86 H106" stroke-width="1.6"/><path d="M70 30 l4 8 h-8 z" fill="' + PALETTE.recon + '" stroke="none"/>'
			+ `<text x="70" y="79" ${STAMP_TEXT} font-size="28" letter-spacing="3" fill="${PALETTE.recon}" stroke="none">RECON</text></g>`),
		make('stamp_hostile', 260, 104, 24, `<g transform="rotate(-6 130 52)" fill="none" stroke="${PALETTE.stronghold}">`
			+ '<rect x="14" y="14" width="232" height="76" rx="4" stroke-width="4"/>'
			+ `<path d="M38 52 l10 -10 l10 10 l-10 10 z M202 52 l10 -10 l10 10 l-10 10 z" fill="${PALETTE.stronghold}" stroke="none"/>`
			+ `<text x="130" y="66" ${STAMP_TEXT} font-size="38" letter-spacing="4" fill="${PALETTE.stronghold}" stroke="none">HOSTILE</text></g>`),
		// The result screens' (DDB-511): a fight or a run lost, and the compound fallen.
		make('stamp_lost', 200, 104, 25, `<g transform="rotate(-7 100 52)" fill="none" stroke="${PALETTE.stronghold}">`
			+ '<rect x="18" y="18" width="164" height="68" rx="4" stroke-width="5"/>'
			+ '<rect x="26" y="26" width="148" height="52" rx="2" stroke-width="1.6"/>'
			+ `<text x="100" y="69" ${STAMP_TEXT} font-size="44" letter-spacing="7" fill="${PALETTE.stronghold}" stroke="none">LOST</text></g>`),
		make('stamp_fallen', 248, 108, 26, `<g transform="rotate(4 124 54)" fill="none" stroke="${PALETTE.stronghold}">`
			+ '<rect x="14" y="16" width="220" height="76" rx="4" stroke-width="4"/>'
			+ `<path d="M34 54 l9 -9 l9 9 l-9 9 z M196 54 l9 -9 l9 9 l-9 9 z" fill="${PALETTE.stronghold}" stroke="none"/>`
			+ `<text x="124" y="70" ${STAMP_TEXT} font-size="42" letter-spacing="5" fill="${PALETTE.stronghold}" stroke="none">FALLEN</text></g>`),
	];
}

/**
 * A tag's tear (DDB-511): a rip run in from the top edge, its gap in
 * shadow and its lip catching the light, for a driver's tag that has
 * picked up an injury. Drawn at a tag's top corner, on any paper.
 */
function tear() {
	const width = 36;
	const height = 48;
	const depth = 42;
	const opening = 8;
	const rng = random('tear_a');
	const lip = [];
	for (let step = 0; step <= 8; step++) {
		const t = step / 8;
		lip.push([24 - 13 * t + (rng() - 0.5) * 4, depth * t]);
	}
	lip[0] = [24, 0];
	// The gap is widest at the edge and closes where the rip stops.
	const far = lip.slice(0, -1).reverse().map(([x, y]) => [x + opening * (1 - y / depth), y]);
	const body = `<defs>${BLUR('tearBlur', 0.8)}</defs>`
		+ `<polyline points="${points(far.map(([x, y]) => [x + 2, y]))}" fill="none" stroke="#3A2A14" stroke-width="3" stroke-opacity="0.35" filter="url(#tearBlur)"/>`
		+ `<polygon points="${points([...lip, ...far])}" fill="${PALETTE.char}" opacity="0.8"/>`
		+ `<polyline points="${points(lip)}" fill="none" stroke="#FFFBF0" stroke-width="1.4"/>`
		+ `<polyline points="${points(far)}" fill="none" stroke="#FFFBF0" stroke-width="0.9" stroke-opacity="0.8"/>`;
	return { name: 'tear_a', width, height, svg: svg(width, height, body), tint: 'none', scale: 1 };
}

// -- cards ------------------------------------------------------------------

/** FinalSplash's card back, deck A or B: atlas stock with a band in the driver's colour and the W in a shield. */
function cardBackGroup(fill, casing) {
	return `<rect width="100" height="140" rx="7" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1.2"/>`
		+ `<rect x="5" y="5" width="90" height="130" rx="4" fill="${fill}" stroke="${casing}" stroke-width="2.5"/>`
		+ `<rect x="11" y="11" width="78" height="118" rx="2" fill="${PALETTE.paper}"/>`
		+ `<rect x="14" y="14" width="72" height="112" fill="none" stroke="${casing}" stroke-width="0.8"/>`
		+ `<path d="M14 34 C 40 24, 60 48, 86 38 M14 46 C 38 38, 62 60, 86 50 M14 102 C 40 92, 62 114, 86 104 M14 114 C 38 106, 60 124, 86 116" stroke="${fill}" stroke-width="1" opacity="0.55" fill="none"/>`
		+ `<path d="M33 54 Q50 47 67 54 L67 78 Q67 93 50 100 Q33 93 33 78 Z" fill="${PALETTE.paper}" stroke="${casing}" stroke-width="2.6"/>`
		+ `<path d="M41 61 L45.5 87 L50 70 L54.5 87 L59 61" fill="none" stroke="${fill}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function cardBacks() {
	const out = [];
	for (const [deck, fill, casing] of [['a', PALETTE.highway, PALETTE.casing], ['b', PALETTE.routeTeal, PALETTE.routeCasing]]) {
		for (const scale of [1, 2]) {
			// The edge stroke is pulled in by its half width so the canvas keeps it whole at 5:7.
			const group = `<g transform="translate(0.6 0.6) scale(${round(98.8 / 100)} ${round(138.8 / 140)})">${cardBackGroup(fill, casing)}</g>`;
			out.push({
				name: scale === 1 ? `card_back_${deck}` : `card_back_${deck}_2x`,
				width: 100 * scale,
				height: 140 * scale,
				svg: svg(100 * scale, 140 * scale, group, '0 0 100 140'),
				tint: 'none',
				scale,
				ground: PALETTE.paper,
			});
		}
	}
	return out;
}

/** A plain card under the top one in a stack: card stock, ink edge, 7 px corners, nine-sliced to any card size. */
function cardEdge() {
	const size = 24;
	const body = `<rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="${PALETTE.cardEdge}" stroke="${PALETTE.ink}" stroke-width="1"/>`;
	return { name: 'card_edge', width: size, height: size, svg: svg(size, size, body), slice: { top: 9, right: 9, bottom: 9, left: 9 }, tint: 'none', scale: 1, ground: PALETTE.cardEdge };
}

// -- logo, mark, icons ------------------------------------------------------

const LOGO_SOURCE = 'docs/design/ui-art-direction/logo.svg';

/** logo.svg baked at 1x (its size on the splash cover, 700 px) and 2x. */
function logos(repoRoot) {
	const source = readFileSync(resolve(repoRoot, LOGO_SOURCE), 'utf8');
	const open = source.match(/<svg[^>]*>/)[0];
	const viewBox = open.match(/viewBox="([^"]+)"/)[1];
	const inner = source.slice(source.indexOf(open) + open.length, source.lastIndexOf('</svg>'));
	return [1, 2].map((scale) => {
		const width = 700 * scale;
		const height = Math.round((470 / 960) * 700) * scale;
		return { name: scale === 1 ? 'logo' : 'logo_2x', width, height, svg: svg(width, height, inner, viewBox), tint: 'none', scale };
	});
}

const NIB_W = '<g id="wOnly" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4 L20 126 L42 40 L64 126 L80 4"/></g>'
	+ '<g id="nibW">'
	+ [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((step) => `<use href="#wOnly" transform="translate(${round(step * 1.64)} ${round(-step * 1.14)})"/>`).join('')
	+ '</g>';

/** FinalLogo's small mark at icon size: the painted W in a highway shield. */
function marks() {
	const body = `<defs>${NIB_W}</defs>`
		+ `<path d="M8 22 Q70 2 132 22 L132 80 Q132 130 70 150 Q8 130 8 80 Z" fill="#F2EDDD" stroke="${PALETTE.ink}" stroke-width="9"/>`
		+ '<g transform="translate(30 22) scale(0.95) skewX(-11)">'
		+ `<g stroke="${PALETTE.casing}" stroke-width="11"><use href="#nibW"/></g>`
		+ `<g stroke="${PALETTE.highway}" stroke-width="5"><use href="#nibW"/></g></g>`;
	return [1, 2].map((scale) => ({
		name: scale === 1 ? 'mark' : 'mark_2x',
		width: 48 * scale,
		height: 54 * scale,
		svg: svg(48 * scale, 54 * scale, body, '0 0 140 156'),
		tint: 'none',
		scale,
	}));
}

/** FinalCompound's resource strip icons, 18 px strokes at 1.6, in white for an ink tint. */
const RESOURCE_ICONS = {
	food: '<rect x="3" y="4" width="12" height="11" rx="1.5" fill="none" stroke-width="1.6"/><path d="M3 7 H15" stroke-width="1.2"/>',
	water: '<path d="M9 2 C 12 7, 14 9, 14 12 A5 5 0 0 1 4 12 C 4 9, 6 7, 9 2 Z" fill="none" stroke-width="1.6"/>',
	fuel: '<path d="M4 5 H12 L14 7 V16 H4 Z M7 2 H11 V5" fill="none" stroke-width="1.6"/>',
	scrap: '<circle cx="9" cy="9" r="4" fill="none" stroke-width="1.6"/><path d="M9 1 V4 M9 14 V17 M1 9 H4 M14 9 H17 M3.3 3.3 L5.4 5.4 M12.6 12.6 L14.7 14.7 M3.3 14.7 L5.4 12.6 M12.6 5.4 L14.7 3.3" stroke-width="1.6"/>',
	meds: '<path d="M7 2 H11 V7 H16 V11 H11 V16 H7 V11 H2 V7 H7 Z" fill="none" stroke-width="1.6"/>',
	people: '<circle cx="9" cy="5" r="3" fill="none" stroke-width="1.6"/><path d="M3 16 C 3 11, 15 11, 15 16" fill="none" stroke-width="1.6"/>',
};

function icons() {
	const out = [];
	for (const [name, body] of Object.entries(RESOURCE_ICONS)) {
		for (const scale of [1, 2]) {
			out.push({
				name: scale === 1 ? `icon_${name}` : `icon_${name}_2x`,
				width: 18 * scale,
				height: 18 * scale,
				svg: svg(18 * scale, 18 * scale, `<g stroke="#fff">${body}</g>`, '0 0 18 18'),
				tint: 'ink',
				scale,
			});
		}
	}
	// The deck glyph: two overlapping card outlines in the two casing colours, so it is baked.
	const deck = `<rect x="1" y="3" width="10" height="14" rx="1.5" fill="${PALETTE.freshPaper}" stroke="${PALETTE.casing}" stroke-width="1.6" transform="rotate(-10 6 10)"/>`
		+ `<rect x="8" y="1" width="10" height="14" rx="1.5" fill="${PALETTE.freshPaper}" stroke="${PALETTE.routeCasing}" stroke-width="1.6" transform="rotate(8 13 8)"/>`;
	for (const scale of [1, 2]) {
		out.push({ name: scale === 1 ? 'icon_deck' : 'icon_deck_2x', width: 20 * scale, height: 18 * scale, svg: svg(20 * scale, 18 * scale, deck, '0 0 20 18'), tint: 'none', scale });
	}
	return out;
}

/**
 * The 2x raster of a 1x piece: the same SVG at twice the pixels (its viewBox,
 * and so every filter, gradient and seed, is unchanged), and its insets in
 * 2x texels with the density that keeps its corners at their 1x size.
 */
function at2x(piece) {
	const width = piece.width * 2;
	const height = piece.height * 2;
	const svg2x = piece.svg.replace(`width="${piece.width}" height="${piece.height}"`, `width="${width}" height="${height}"`);
	if (svg2x === piece.svg) throw new Error(`${piece.name}: no root size to double`);
	const slice = piece.slice
		? { top: piece.slice.top * 2, right: piece.slice.right * 2, bottom: piece.slice.bottom * 2, left: piece.slice.left * 2, scale: 2 }
		: undefined;
	return { ...piece, name: `${piece.name}_2x`, width, height, svg: svg2x, slice, scale: 2 };
}

/** Every piece, in a fixed order (the packer sorts its own copy). */
export function authorPieces(repoRoot) {
	const sliced = [
		...PAPER_VARIANTS.map(paperW1),
		...PAPER_VARIANTS.map(paperW2),
		...PAPER_VARIANTS.map(paperW3),
		atlasCover(),
		...['a', 'b', 'c', 'd'].map(highlighter),
		cardEdge(),
	];
	return [
		...sliced,
		...sliced.map(at2x),
		paperFold(),
		...PAPER_VARIANTS.map(tape),
		...['a', 'b', 'c', 'd'].map(greaseLoop),
		...stamps(),
		tear(),
		...cardBacks(),
		...logos(repoRoot),
		...marks(),
		...icons(),
	];
}

