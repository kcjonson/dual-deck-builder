#!/usr/bin/env node
// Writes the game's generated vector art into apps/wasteland-wheels/art/ (procedural-paper.md, Everything else): the
// logo and the small mark, flattened from docs/design/ui-art-direction/, and the stamps, from the canvas's Materials
// board as legacy's ui-art pieces set them. salal reads plain fills and solid strokes only, filled by the nonzero rule,
// so what the mocks do with filters, masks, <use>, dashes and text is geometry here:
//
// - A broad-nib stroke (the mocks' 11 or 13 copies of a path stepped along the nib) is the nib swept along each
//   segment and rounded by the stroke's half width: one convex hull a segment, all wound the same way, so they union.
// - A dashed stroke is a quad a dash; the tracks' fading ends are opacity steps.
// - A stamp's lettering is outlined capitals in the display face's proportions, holes wound the other way.
//
// Run it after changing anything below: node scripts/vector-art.mjs. Hand-drawn art (the tape, the cover's pieces)
// lives in the same folder and isn't written here.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/wasteland-wheels/art');

const num = (value) => {
	const rounded = Math.round(value * 100) / 100;
	return Object.is(rounded, -0) ? '0' : String(rounded);
};

// -- geometry -----------------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const length = (a) => Math.hypot(a[0], a[1]);
const normalize = (a) => scale(a, 1 / length(a));

function area(points) {
	let sum = 0;
	for (let i = 0; i < points.length; i += 1) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum += a[0] * b[1] - b[0] * a[1];
	}
	return sum / 2;
}

// Solid contours wind positive, holes negative: under the nonzero rule solids union and a hole cuts its solid.
const solid = (points) => (area(points) < 0 ? [...points].reverse() : points);
const hole = (points) => (area(points) > 0 ? [...points].reverse() : points);

// Andrew's monotone chain; positive area, as `solid` winds.
function hull(points) {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list) => {
		const out = [];
		for (const point of list) {
			while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) {
				out.pop();
			}
			out.push(point);
		}
		out.pop();
		return out;
	};
	return solid([...half(sorted), ...half([...sorted].reverse())]);
}

function flattenCubic(p0, p1, p2, p3, tolerance, out, depth = 0) {
	const chord = sub(p3, p0);
	const chordLength = length(chord) || 1;
	const distance = (p) => Math.abs((p[0] - p0[0]) * chord[1] - (p[1] - p0[1]) * chord[0]) / chordLength;
	if (depth > 12 || Math.max(distance(p1), distance(p2)) <= tolerance) {
		out.push(p3);
		return;
	}
	const mid = (a, b) => scale(add(a, b), 0.5);
	const p01 = mid(p0, p1);
	const p12 = mid(p1, p2);
	const p23 = mid(p2, p3);
	const p012 = mid(p01, p12);
	const p123 = mid(p12, p23);
	const centre = mid(p012, p123);
	flattenCubic(p0, p01, p012, centre, tolerance, out, depth + 1);
	flattenCubic(centre, p123, p23, p3, tolerance, out, depth + 1);
}

// An SVG path's subpaths as polylines: absolute M, L, H, V, C, S and Z, which is all the sources use.
function polylines(d, tolerance, offset = [0, 0]) {
	const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g);
	const lines = [];
	let current = null;
	let pen = [0, 0];
	let lastControl = null;
	let command = null;
	let i = 0;
	const read = () => Number(tokens[i++]);
	const point = () => [read() + offset[0], read() + offset[1]];
	while (i < tokens.length) {
		if (/[A-Za-z]/.test(tokens[i])) {
			command = tokens[i++];
		}
		switch (command) {
			case 'M':
				pen = point();
				current = { points: [pen], closed: false };
				lines.push(current);
				command = 'L';
				lastControl = null;
				break;
			case 'L':
				pen = point();
				current.points.push(pen);
				lastControl = null;
				break;
			case 'H':
				pen = [read() + offset[0], pen[1]];
				current.points.push(pen);
				lastControl = null;
				break;
			case 'V':
				pen = [pen[0], read() + offset[1]];
				current.points.push(pen);
				lastControl = null;
				break;
			case 'C': {
				const c1 = point();
				const c2 = point();
				const end = point();
				flattenCubic(pen, c1, c2, end, tolerance, current.points);
				lastControl = c2;
				pen = end;
				break;
			}
			case 'S': {
				const c1 = lastControl ? sub(scale(pen, 2), lastControl) : pen;
				const c2 = point();
				const end = point();
				flattenCubic(pen, c1, c2, end, tolerance, current.points);
				lastControl = c2;
				pen = end;
				break;
			}
			case 'Z':
				current.closed = true;
				pen = current.points[0];
				command = null;
				break;
			default:
				throw new Error(`vector-art: path command ${command} isn't handled: ${d}`);
		}
	}
	return lines;
}

// A broad nib swept along a polyline from -nib to +nib, rounded by `radius`: one hull a segment.
function brush(line, nib, radius) {
	const steps = radius > 0 ? Math.max(4, Math.ceil((2 * Math.PI * radius) / 2.5)) : 1;
	const round = (centre) => {
		if (radius <= 0) {
			return [centre];
		}
		return Array.from({ length: steps }, (_, k) => {
			const angle = (2 * Math.PI * k) / steps;
			return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
		});
	};
	const points = line.closed ? [...line.points, line.points[0]] : line.points;
	const contours = [];
	for (let i = 0; i + 1 < points.length; i += 1) {
		const a = points[i];
		const b = points[i + 1];
		const corners = [sub(a, nib), add(a, nib), sub(b, nib), add(b, nib)];
		contours.push(hull(corners.flatMap(round)));
	}
	return contours;
}

// A stroke's outline: each side offset by half its width, mitered, butt-ended; a closed one is an outer and a hole.
function offsetSides(points, closed, width) {
	const halfWidth = width / 2;
	const count = points.length;
	const normalOf = (a, b) => {
		const direction = normalize(sub(b, a));
		return [-direction[1], direction[0]];
	};
	const left = [];
	const right = [];
	for (let i = 0; i < count; i += 1) {
		const previous = closed ? points[(i - 1 + count) % count] : points[i - 1];
		const next = closed ? points[(i + 1) % count] : points[i + 1];
		const before = previous ? normalOf(previous, points[i]) : null;
		const after = next ? normalOf(points[i], next) : null;
		let miter = before && after ? normalize(add(before, after)) : (before ?? after);
		const reach = halfWidth / Math.max(0.25, dot(miter, after ?? before));
		miter = scale(miter, reach);
		left.push(add(points[i], miter));
		right.push(sub(points[i], miter));
	}
	return { left, right };
}

const strokeOpen = (points, width) => {
	const { left, right } = offsetSides(points, false, width);
	return [solid([...left, ...right.reverse()])];
};

const strokeClosed = (points, width) => {
	const { left, right } = offsetSides(points, true, width);
	const [outer, inner] = Math.abs(area(left)) > Math.abs(area(right)) ? [left, right] : [right, left];
	return [solid(outer), hole(inner)];
};

const box = (x0, y0, x1, y1) => solid([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

// A superellipse arc, angles in radians from +x, y down.
function superellipse(cx, cy, rx, ry, power, from, to, samples) {
	const out = [];
	for (let k = 0; k <= samples; k += 1) {
		const angle = from + ((to - from) * k) / samples;
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		out.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / power), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / power)]);
	}
	return out;
}

const pathData = (contours) =>
	contours
		.map((contour) => `M${contour.map(([x, y]) => `${num(x)} ${num(y)}`).join(' ')}Z`)
		.join('');

// -- the logo (logo.svg) --------------------------------------------------------

// WHEELS: each letter's strokes, at its x in the word.
const WHEELS = [
	[0, 'M4 4 L20 126 L42 40 L64 126 L80 4'],
	[108, 'M8 4 V126 M54 4 V126 M8 66 L54 64'],
	[192, 'M46 6 L8 4 V126 L48 124 M8 64 L40 62'],
	[266, 'M46 6 L8 4 V126 L48 124 M8 64 L40 62'],
	[340, 'M8 4 V124 L46 124'],
	[404, 'M52 20 C 46 4, 30 2, 26 2 C 10 2, 4 14, 4 30 C 4 50, 52 56, 52 88 C 52 116, 36 128, 24 128 C 12 128, 4 120, 0 106'],
];

// Wasteland, in the broad-nib script.
const WASTELAND = [
	'M4 30 C 6 20, 14 18, 18 26 L 30 100 L 50 40 L 66 100 L 86 22 C 88 16, 94 16, 96 22',
	'M128 64 C 118 56, 100 58, 98 78 C 96 96, 112 104, 124 92 M128 62 L 127 94 C 127 102, 134 104, 142 96',
	'M142 96 C 148 84, 154 68, 156 56 C 168 72, 168 90, 156 100 C 150 104, 142 102, 142 95 M157 99 C 163 101, 169 100, 174 96',
	'M184 26 L 176 94 C 175 102, 182 104, 190 98 M166 58 L 200 55',
	'M190 98 C 204 90, 218 76, 210 64 C 202 54, 190 68, 192 84 C 194 100, 212 102, 222 92',
	'M222 92 C 236 70, 248 30, 240 20 C 232 12, 224 38, 226 70 C 228 96, 234 102, 246 94',
	'M272 64 C 262 56, 246 60, 244 78 C 242 96, 258 104, 270 92 M274 62 L 272 94 C 272 102, 278 104, 286 96',
	'M290 62 L 288 98 M289 74 C 294 60, 314 56, 316 70 L 314 94 C 314 102, 320 104, 328 96',
	'M352 64 C 342 56, 326 60, 324 78 C 322 96, 338 104, 350 92 M360 12 L 354 94 C 353 102, 360 104, 368 98 C 400 84, 440 80, 486 70',
];

const W_ONLY = 'M4 4 L20 126 L42 40 L64 126 L80 4';

const NIB_CAPS = [9.84, -6.84];
const NIB_SCRIPT = [4.1, -2.85];
const PALETTE = {
	ink: '#23221F',
	paperLight: '#F2EDDD',
	highway: '#D86036',
	casing: '#682C1E',
	shadow: '#3B1A10',
	stronghold: '#A3221B',
	looted: '#9A4F2E',
};

// One <path> a source element: its strokes brushed, filled in `fill`.
function brushed(paths, nib, strokeWidth, fill, tolerance) {
	return paths
		.map(([x, d]) => {
			const contours = polylines(d, tolerance, [x, 0]).flatMap((line) => brush(line, nib, strokeWidth / 2));
			return `\t\t<path d="${pathData(contours)}" fill="${fill}"/>`;
		})
		.join('\n');
}

// The wheel's tread: the mock's 26 px stroke dashed 20 on, 11 off round r 186, a sector a dash.
function tread() {
	const radius = 186;
	const halfWidth = 13;
	const circumference = 2 * Math.PI * radius;
	const contours = [];
	for (let start = 0; start < circumference; start += 31) {
		const end = Math.min(start + 20, circumference);
		const arc = (r, from, to) => [0, 1, 2].map((k) => {
			const angle = (from + ((to - from) * k) / 2) / radius;
			return [r * Math.cos(angle), r * Math.sin(angle)];
		});
		contours.push(solid([...arc(radius + halfWidth, start, end), ...arc(radius - halfWidth, end, start)]));
	}
	return pathData(contours);
}

// The tire tracks: two treads of two dashed 9 px strokes each, faded in and out along x as the mock's mask does.
function tracks() {
	const treads = [
		'M0 34 C 220 -6, 430 60, 640 18 S 840 -14, 900 -22',
		'M0 -10 C 230 44, 440 -12, 660 30 S 850 34, 900 30',
	];
	const rows = [
		{ dy: -6, offset: 0 },
		{ dy: 5, offset: 5.5 },
	];
	const fade = (x) => {
		const t = x / 900;
		if (t <= 0 || t >= 1) {
			return 0;
		}
		if (t < 0.12) {
			return t / 0.12;
		}
		return t <= 0.8 ? 1 : (1 - t) / 0.2;
	};
	const buckets = new Map();
	for (const d of treads) {
		for (const row of rows) {
			const [line] = polylines(d, 0.05, [0, row.dy]);
			const cumulative = [0];
			for (let i = 1; i < line.points.length; i += 1) {
				cumulative.push(cumulative[i - 1] + length(sub(line.points[i], line.points[i - 1])));
			}
			const total = cumulative[cumulative.length - 1];
			const at = (s) => {
				let i = 1;
				while (i < cumulative.length - 1 && cumulative[i] < s) {
					i += 1;
				}
				const a = line.points[i - 1];
				const b = line.points[i];
				const span = cumulative[i] - cumulative[i - 1] || 1;
				const t = Math.min(1, Math.max(0, (s - cumulative[i - 1]) / span));
				const tangent = normalize(sub(b, a));
				return { point: add(a, scale(sub(b, a), t)), normal: [-tangent[1], tangent[0]] };
			};
			// A dash pattern of 7 on and 4 off, started `offset` into it.
			for (let s = -row.offset; s < total; s += 11) {
				const from = Math.max(0, s);
				const to = Math.min(total, s + 7);
				if (to - from < 0.5) {
					continue;
				}
				const samples = [from, (from + to) / 2, to].map(at);
				const level = Math.round(fade(samples[1].point[0]) * 10) / 10;
				if (level <= 0) {
					continue;
				}
				const contour = solid([
					...samples.map(({ point, normal }) => add(point, scale(normal, 4.5))),
					...samples.reverse().map(({ point, normal }) => sub(point, scale(normal, 4.5))),
				]);
				if (!buckets.has(level)) {
					buckets.set(level, []);
				}
				buckets.get(level).push(contour);
			}
		}
	}
	return [...buckets.entries()]
		.sort(([a], [b]) => a - b)
		.map(([level, contours]) => `\t\t<path d="${pathData(contours)}" fill="${PALETTE.ink}" fill-opacity="${num(0.6 * level)}"/>`)
		.join('\n');
}

function logo() {
	const spokes = [0, 60, 120, 180, 240, 300]
		.map((turn) => `\t\t<ellipse cx="0" cy="-72" rx="17" ry="25" fill="#CFC5AB" stroke="#9E937C" stroke-width="2.5" transform="rotate(${turn})"/>`)
		.join('\n');
	const lugs = [
		[0, -22],
		[20.9, -6.8],
		[12.9, 17.8],
		[-12.9, 17.8],
		[-20.9, -6.8],
	]
		.map(([x, y]) => `\t\t<circle cx="${x}" cy="${y}" r="5.5" fill="#9E937C"/>`)
		.join('\n');
	const caps = WHEELS;
	const script = WASTELAND.map((d) => [0, d]);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="470" viewBox="20 -15 960 470">
<!-- The logo (UI Art Direction, Logo), flattened from docs/design/ui-art-direction/logo.svg by scripts/vector-art.mjs:
     the wheel, the tire tracks, WHEELS on its casing over its drop shadow, and Wasteland in its paper halo. The brush
     edges and the chipped paint wait until they're redrawn as geometry. -->
	<g transform="translate(744 206) rotate(9) scale(1.02)">
		<circle r="200" fill="#D6CCB2"/>
		<path d="${tread()}" fill="#C2B699"/>
		<circle r="200" fill="none" stroke="#9E937C" stroke-width="3"/>
		<circle r="168" fill="none" stroke="#9E937C" stroke-width="3"/>
		<circle r="124" fill="#E8E1CC" stroke="#9E937C" stroke-width="4"/>
		<circle r="108" fill="none" stroke="#9E937C" stroke-width="2"/>
${spokes}
		<circle r="38" fill="#E8E1CC" stroke="#9E937C" stroke-width="4"/>
${lugs}
	</g>
	<g transform="translate(60 352)">
${tracks()}
	</g>
	<g transform="translate(128 146) rotate(-2) scale(1.62) skewX(-11)">
	<g transform="translate(5 5)">
${brushed(caps, NIB_CAPS, 4, PALETTE.shadow, 0.3)}
	</g>
${brushed(caps, NIB_CAPS, 9, PALETTE.casing, 0.3)}
${brushed(caps, NIB_CAPS, 4, PALETTE.highway, 0.3)}
	</g>
	<g transform="translate(104 -6) rotate(-5 250 60) scale(1.36) skewX(-14)">
${brushed(script, NIB_SCRIPT, 7, PALETTE.paperLight, 0.4)}
${brushed(script, NIB_SCRIPT, 2.4, PALETTE.ink, 0.4)}
	</g>
</svg>
`;
}

// -- the small mark (mark.svg, mark-small.svg) ------------------------------------

const SHIELD = 'M8 22 Q70 2 132 22 L132 80 Q132 130 70 150 Q8 130 8 80 Z';

function mark({ small }) {
	const w = [[0, W_ONLY]];
	const layers = small
		? [brushed(w, NIB_CAPS, 11, PALETTE.casing, 0.3), brushed(w, NIB_CAPS, 5, PALETTE.highway, 0.3)]
		: [
				`\t<g transform="translate(4 4)">\n${brushed(w, NIB_CAPS, 4, PALETTE.shadow, 0.3)}\n\t</g>`,
				brushed(w, NIB_CAPS, 9, PALETTE.casing, 0.3),
				brushed(w, NIB_CAPS, 4, PALETTE.highway, 0.3),
			];
	const source = small ? 'mark-small.svg, the icon-size variant: no shadow, heavier strokes' : 'mark.svg';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="156" viewBox="0 0 140 156">
<!-- The small mark, the painted W in a highway shield (UI Art Direction, Logo), from docs/design/ui-art-direction/${source},
     its nib strokes brushed by scripts/vector-art.mjs. -->
	<path d="${SHIELD}" fill="${PALETTE.paperLight}" stroke="${PALETTE.ink}" stroke-width="${small ? 9 : 7}"/>
	<g transform="translate(30 22) scale(0.95) skewX(-11)">
${layers.join('\n')}
	</g>
</svg>
`;
}

// -- the stamps -------------------------------------------------------------------

// Capitals in the display face's proportions, cap height 100, y down from the cap line, stem STEM. Each is its
// contours, its width and its side bearing.
const STEM = 15;
const H = STEM / 2;

const GLYPHS = {
	L: { width: 44, bearing: 6, contours: () => strokeOpen([[H, 0], [H, 100 - H], [44, 100 - H]], STEM) },
	E: {
		width: 46,
		bearing: 6,
		contours: () => [...strokeOpen([[46, H], [H, H], [H, 100 - H], [46, 100 - H]], STEM), box(H, 48 - H, 40, 48 + H)],
	},
	F: {
		width: 45,
		bearing: 6,
		contours: () => [...strokeOpen([[45, H], [H, H], [H, 100]], STEM), box(H, 50 - H, 39, 50 + H)],
	},
	T: { width: 50, bearing: 2, contours: () => [box(0, 0, 50, STEM), box(25 - H, 0, 25 + H, 100)] },
	N: {
		width: 54,
		bearing: 6,
		contours: () => {
			const d = STEM * 1.3;
			return [box(0, 0, STEM, 100), box(54 - STEM, 0, 54, 100), solid([[0, 0], [d, 0], [54, 100], [54 - d, 100]])];
		},
	},
	A: {
		width: 56,
		bearing: 2,
		contours: () => {
			const centre = 28;
			const apex = STEM * 0.55;
			const leg = STEM * 1.15;
			const left = (y) => (centre - apex) * (1 - y / 100);
			const bar = [66, 66 + STEM * 0.85];
			return [
				solid([[0, 100], [centre - apex, 0], [centre - apex + leg, 0], [leg, 100]]),
				solid([[56, 100], [56 - leg, 100], [centre + apex - leg, 0], [centre + apex, 0]]),
				box(left(bar[0]), bar[0], 56 - left(bar[0]), bar[1]),
			];
		},
	},
	O: {
		width: 54,
		bearing: 5,
		contours: () => strokeClosed(superellipse(27, 50, 27 - H, 50 - H, 2.4, 0, 2 * Math.PI, 64).slice(0, -1), STEM),
	},
	D: {
		width: 54,
		bearing: 6,
		contours: () => {
			const bowl = 22;
			const arc = superellipse(bowl, 50, 54 - H - bowl, 50 - H, 2.4, -Math.PI / 2, Math.PI / 2, 32);
			return strokeClosed([[H, H], ...arc, [H, 100 - H]], STEM);
		},
	},
	S: {
		width: 50,
		bearing: 5,
		contours: () => {
			// The logo's stencil S, its centre line fitted to the box.
			const stencil = 'M52 12 C 46 2, 34 2, 28 2 C 12 2, 6 10, 6 18 C 6 34, 50 26, 50 42 C 50 54, 40 58, 28 58 C 16 58, 8 54, 2 46';
			const [line] = polylines(stencil, 0.05);
			const fitted = line.points.map(([x, y]) => [H + ((x - 2) / 50) * (50 - STEM), H + ((y - 2) / 56) * (100 - STEM)]);
			return strokeOpen(fitted, STEM);
		},
	},
};

// `word` centred on (x, baseline) at `size` px, whose cap height is 0.7 of it, `spacing` px between letters.
function lettering(word, x, baseline, size, spacing) {
	const unit = (size * 0.7) / 100;
	const letters = [...word].map((letter) => {
		const glyph = GLYPHS[letter];
		if (!glyph) {
			throw new Error(`vector-art: no glyph for ${letter}`);
		}
		return glyph;
	});
	const advance = (glyph) => (glyph.width + 2 * glyph.bearing) * unit;
	const total = letters.reduce((sum, glyph) => sum + advance(glyph), 0) + spacing * (letters.length - 1);
	let pen = x - total / 2;
	const top = baseline - 100 * unit;
	const contours = [];
	for (const glyph of letters) {
		const left = pen + glyph.bearing * unit;
		for (const contour of glyph.contours()) {
			contours.push(contour.map(([gx, gy]) => [left + gx * unit, top + gy * unit]));
		}
		pen += advance(glyph) + spacing;
	}
	return pathData(contours);
}

function stamp({ width, height, turn, colour, frames, marks = '', word, baseline, size, spacing, what }) {
	const centre = [width / 2, height / 2];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<!-- The ${word} stamp (UI Art Direction, Wear: W3's hero mark), ${what}, from the canvas's Materials board as
     legacy's ui-art pieces set it, written by scripts/vector-art.mjs: its frame, and its word in outlined capitals. -->
	<g transform="rotate(${turn} ${centre[0]} ${centre[1]})">
${frames.map((frame) => `\t\t${frame.replace('/>', ` fill="none" stroke="${colour}"/>`)}`).join('\n')}${marks ? `\n\t\t<path d="${marks}" fill="${colour}"/>` : ''}
		<path d="${lettering(word, centre[0], baseline, size, spacing)}" fill="${colour}"/>
	</g>
</svg>
`;
}

const STAMPS = [
	{
		name: 'stamp-lost',
		what: 'struck on a fight or a run lost',
		width: 200,
		height: 104,
		turn: -7,
		colour: PALETTE.stronghold,
		frames: ['<rect x="18" y="18" width="164" height="68" rx="4" stroke-width="5"/>', '<rect x="26" y="26" width="148" height="52" rx="2" stroke-width="1.6"/>'],
		word: 'LOST',
		baseline: 69,
		size: 44,
		spacing: 7,
	},
	{
		name: 'stamp-fallen',
		what: 'struck on the compound fallen',
		width: 248,
		height: 108,
		turn: 4,
		colour: PALETTE.stronghold,
		frames: ['<rect x="14" y="16" width="220" height="76" rx="4" stroke-width="4"/>'],
		marks: 'M34 54 L43 45 L52 54 L43 63 Z M196 54 L205 45 L214 54 L205 63 Z',
		word: 'FALLEN',
		baseline: 70,
		size: 42,
		spacing: 5,
	},
	{
		name: 'stamp-looted',
		what: 'struck on a cleared POI',
		width: 232,
		height: 110,
		turn: -8,
		colour: PALETTE.looted,
		frames: ['<rect x="16" y="22" width="200" height="66" rx="5" stroke-width="5"/>'],
		word: 'LOOTED',
		baseline: 71,
		size: 44,
		spacing: 5,
	},
];

// -- write ----------------------------------------------------------------------

const files = {
	'logo.svg': logo(),
	'mark.svg': mark({ small: false }),
	'mark-small.svg': mark({ small: true }),
	...Object.fromEntries(STAMPS.map((piece) => [`${piece.name}.svg`, stamp(piece)])),
};
for (const [name, text] of Object.entries(files)) {
	writeFileSync(resolve(ART, name), text);
	console.log(`${name}: ${(text.length / 1024).toFixed(1)} KB`);
}
