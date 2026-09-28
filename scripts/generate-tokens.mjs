/**
 * R11.2's generator: `src/renderer/engine/theme/tokens.json` becomes the
 * committed `tokens.ts` beside it. Plain JavaScript with no dependencies so it
 * runs on the CI Node without a TypeScript step.
 *
 *   node scripts/generate-tokens.mjs            write tokens.ts
 *   node scripts/generate-tokens.mjs --check    exit 1 when tokens.ts is stale
 *   node scripts/generate-tokens.mjs --stdout   print the module instead of writing it
 *   node scripts/generate-tokens.mjs --input <file> --stdout
 *
 * The file format, per R11.1: top-level keys are categories, each holding
 * tokens by name. A token is `{ value, css?, cssOnly?, description? }` or
 * `{ alias: "category.name", description? }`. Anywhere inside a value, an
 * object that is exactly `{ alias: "category.name" }` is replaced by that
 * token's resolved value, so an elevation preset can take its colour from the
 * colour category. Colour values are normalised RGBA floats; a `css` form
 * beside one must describe the same colour, which keeps the two from drifting
 * inside the file itself. `cssOnly` tokens exist for a web prototype and are
 * left out of the module.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = resolve(repoRoot, 'src/renderer/engine/theme/tokens.json');
const defaultOutput = resolve(repoRoot, 'src/renderer/engine/theme/tokens.ts');

/** R11.3. `texture` and `density` are the optional ones. */
const REQUIRED_CATEGORIES = [
	'color',
	'space',
	'radius',
	'borderWidth',
	'fontSize',
	'lineHeight',
	'letterSpacing',
	'motion',
	'layer',
	'elevation',
	'typography',
	'control',
];
const OPTIONAL_CATEGORIES = ['texture', 'density'];
const KNOWN_CATEGORIES = new Set([...REQUIRED_CATEGORIES, ...OPTIONAL_CATEGORIES]);

/** Categories whose every value is a plain finite number. */
const NUMERIC_CATEGORIES = new Set([
	'space',
	'radius',
	'borderWidth',
	'fontSize',
	'lineHeight',
	'letterSpacing',
	'control',
	'texture',
	'density',
]);

const TOKEN_NAME = /^[a-z][a-z0-9_]*$/;
const TOKEN_KEYS = new Set(['value', 'alias', 'css', 'cssOnly', 'description']);

/** Half a step of an 8-bit channel: the most a rounded float may differ from its css form. */
const CSS_CHANNEL_TOLERANCE = 0.5 / 255 + 1e-9;

export class TokenError extends Error {
	constructor(message) {
		super(message);
		this.name = 'TokenError';
	}
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAliasObject(value) {
	return isPlainObject(value) && Object.keys(value).length === 1 && typeof value.alias === 'string';
}

/**
 * `#rgb`, `#rrggbb`, `#rrggbbaa`, and `rgb()`/`rgba()` with 0-255 channels.
 * Returns null for anything else so the caller can name the token.
 */
export function parseCssColor(css) {
	const text = css.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
	if (hex) {
		let digits = hex[1];
		if (digits.length === 3) {
			digits = digits
				.split('')
				.map((digit) => digit + digit)
				.join('');
		}
		const channels = [];
		for (let index = 0; index < digits.length; index += 2) {
			channels.push(parseInt(digits.slice(index, index + 2), 16) / 255);
		}
		if (channels.length === 3) channels.push(1);
		return channels;
	}
	const functional = /^rgba?\(\s*([^)]*)\)$/.exec(text);
	if (functional) {
		const parts = functional[1].split(/\s*,\s*/).map(Number);
		if ((parts.length !== 3 && parts.length !== 4) || parts.some((part) => !Number.isFinite(part))) {
			return null;
		}
		const [red, green, blue, alpha = 1] = parts;
		return [red / 255, green / 255, blue / 255, alpha];
	}
	return null;
}

function isRgba(value) {
	return (
		Array.isArray(value) &&
		value.length === 4 &&
		value.every((channel) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)
	);
}

function checkShape(source) {
	if (!isPlainObject(source)) throw new TokenError('the token file must be a JSON object of categories');
	const seen = new Map();
	for (const [category, tokens] of Object.entries(source)) {
		if (category.startsWith('$')) continue;
		if (!KNOWN_CATEGORIES.has(category)) {
			throw new TokenError(`unknown category "${category}"; R11.3 allows ${[...KNOWN_CATEGORIES].join(', ')}`);
		}
		if (!isPlainObject(tokens)) throw new TokenError(`category "${category}" must be an object of tokens`);
		for (const [name, token] of Object.entries(tokens)) {
			const path = `${category}.${name}`;
			if (!TOKEN_NAME.test(name)) throw new TokenError(`${path}: token names are lower snake case`);
			// R11.4: leaf names are the shared identifiers, so one leaf names one token.
			if (seen.has(name)) throw new TokenError(`${path}: leaf name "${name}" is already used by ${seen.get(name)}`);
			seen.set(name, path);
			if (!isPlainObject(token)) throw new TokenError(`${path}: a token is an object`);
			for (const key of Object.keys(token)) {
				if (!TOKEN_KEYS.has(key)) throw new TokenError(`${path}: unknown key "${key}"`);
			}
			const hasValue = 'value' in token;
			const hasAlias = 'alias' in token;
			if (token.cssOnly === true) {
				if (typeof token.css !== 'string') throw new TokenError(`${path}: a cssOnly token needs a css form`);
				if (hasValue || hasAlias) throw new TokenError(`${path}: a cssOnly token has no numeric value`);
				continue;
			}
			if (hasValue === hasAlias) throw new TokenError(`${path}: a token has exactly one of value and alias`);
			if (hasAlias && typeof token.alias !== 'string') throw new TokenError(`${path}: alias is a "category.name" string`);
		}
	}
	for (const category of REQUIRED_CATEGORIES) {
		if (!isPlainObject(source[category])) throw new TokenError(`missing required category "${category}" (R11.3)`);
	}
}

function createResolver(source) {
	const resolved = new Map();
	const resolving = new Set();

	function lookup(reference, from) {
		const [category, name, ...rest] = reference.split('.');
		const known = rest.length === 0 && Object.hasOwn(source, category) && isPlainObject(source[category]) && Object.hasOwn(source[category], name);
		const token = known ? source[category][name] : undefined;
		if (!token) throw new TokenError(`${from}: alias "${reference}" names no token`);
		if (token.cssOnly === true) throw new TokenError(`${from}: alias "${reference}" names a cssOnly token`);
		return resolveToken(category, name);
	}

	function resolveValue(value, from) {
		if (isAliasObject(value)) return lookup(value.alias, from);
		if (Array.isArray(value)) return value.map((item) => resolveValue(item, from));
		if (isPlainObject(value)) {
			const out = {};
			for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, from);
			return out;
		}
		return value;
	}

	function resolveToken(category, name) {
		const path = `${category}.${name}`;
		if (resolved.has(path)) return resolved.get(path);
		if (resolving.has(path)) throw new TokenError(`${path}: alias cycle through ${[...resolving].join(' -> ')}`);
		resolving.add(path);
		const token = source[category][name];
		const value = 'alias' in token ? lookup(token.alias, path) : resolveValue(token.value, path);
		resolving.delete(path);
		resolved.set(path, value);
		return value;
	}

	return resolveToken;
}

function checkValue(category, name, token, value) {
	const path = `${category}.${name}`;
	if (NUMERIC_CATEGORIES.has(category)) {
		if (typeof value !== 'number' || !Number.isFinite(value)) throw new TokenError(`${path}: expected a number`);
		return;
	}
	switch (category) {
		case 'color': {
			if (!isRgba(value)) throw new TokenError(`${path}: a colour is four normalised floats [r, g, b, a]`);
			if (typeof token.css === 'string') {
				const fromCss = parseCssColor(token.css);
				if (!fromCss) throw new TokenError(`${path}: css "${token.css}" is not a colour this generator reads`);
				const drift = fromCss.findIndex((channel, index) => Math.abs(channel - value[index]) > CSS_CHANNEL_TOLERANCE);
				if (drift !== -1) {
					throw new TokenError(`${path}: value [${value.join(', ')}] does not match css "${token.css}" (channel ${drift})`);
				}
			}
			return;
		}
		case 'motion': {
			const isDuration = typeof value === 'number' && Number.isFinite(value) && value >= 0;
			const isEase = Array.isArray(value) && value.length === 4 && value.every((point) => typeof point === 'number' && Number.isFinite(point));
			if (!isDuration && !isEase) {
				throw new TokenError(`${path}: motion is a duration in ms or four cubic-bezier control points`);
			}
			if (isEase && typeof token.css === 'string') {
				const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(token.css.trim());
				const points = bezier ? bezier[1].split(',').map(Number) : [];
				if (points.length !== 4 || points.some((point, index) => point !== value[index])) {
					throw new TokenError(`${path}: value [${value.join(', ')}] does not match css "${token.css}"`);
				}
			}
			return;
		}
		case 'layer':
			if (typeof value !== 'string') throw new TokenError(`${path}: a layer token names a layer`);
			return;
		case 'elevation': {
			if (!isPlainObject(value)) throw new TokenError(`${path}: an elevation preset is { color, blur, spread, offset }`);
			if (!isRgba(value.color)) throw new TokenError(`${path}: elevation color must resolve to [r, g, b, a]`);
			for (const key of ['blur', 'spread']) {
				if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new TokenError(`${path}: elevation ${key} must be a number`);
			}
			const offset = value.offset;
			if (!Array.isArray(offset) || offset.length !== 2 || !offset.every((axis) => typeof axis === 'number')) {
				throw new TokenError(`${path}: elevation offset is [x, y]`);
			}
			return;
		}
		default:
			// typography carries structured role records; the unit test checks their shape.
			return;
	}
}

/**
 * Returns `{ category: { name: { value, alias } } }` in file order with every
 * alias resolved and cssOnly tokens dropped.
 */
export function resolveTokens(source) {
	checkShape(source);
	const resolveToken = createResolver(source);
	const out = {};
	for (const [category, tokens] of Object.entries(source)) {
		if (category.startsWith('$')) continue;
		out[category] = {};
		for (const [name, token] of Object.entries(tokens)) {
			if (token.cssOnly === true) continue;
			const value = resolveToken(category, name);
			checkValue(category, name, token, value);
			out[category][name] = { value, alias: token.alias ?? null };
		}
	}
	return out;
}

function formatValue(value, indent) {
	if (Array.isArray(value)) return `[${value.map((item) => formatValue(item, indent)).join(', ')}]`;
	if (isPlainObject(value)) {
		const inner = `${indent}\t`;
		const lines = Object.entries(value).map(([key, item]) => `${inner}${key}: ${formatValue(item, inner)},`);
		return `{\n${lines.join('\n')}\n${indent}}`;
	}
	if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	return JSON.stringify(value);
}

function typeName(category) {
	return `${category[0].toUpperCase()}${category.slice(1)}Token`;
}

export function generateModule(source) {
	const resolved = resolveTokens(source);
	const lines = [
		'// Generated by scripts/generate-tokens.mjs from tokens.json. Do not edit by hand:',
		'// change tokens.json and run `npm run tokens`. tokens.test.ts fails when this file is stale (R11.2).',
		'',
		'export const tokens = {',
	];
	for (const [category, entries] of Object.entries(resolved)) {
		lines.push(`\t${category}: {`);
		for (const [name, { value, alias }] of Object.entries(entries)) {
			const comment = alias ? ` // = ${alias}` : '';
			lines.push(`\t\t${name}: ${formatValue(value, '\t\t')},${comment}`);
		}
		lines.push('\t},');
	}
	lines.push('} as const;', '', 'export type Tokens = typeof tokens;', '');
	for (const category of Object.keys(resolved)) {
		lines.push(`export type ${typeName(category)} = keyof Tokens['${category}'];`);
	}
	lines.push('');
	return lines.join('\n');
}

function readSource(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new TokenError(`cannot read ${path}: ${error.message}`);
	}
}

function main(argv) {
	const inputIndex = argv.indexOf('--input');
	const inputPath = inputIndex === -1 ? defaultInput : resolve(argv[inputIndex + 1] ?? '');
	const moduleText = generateModule(readSource(inputPath));
	if (argv.includes('--stdout')) {
		process.stdout.write(moduleText);
		return 0;
	}
	if (argv.includes('--check')) {
		let committed = '';
		try {
			// A Windows checkout with autocrlf holds CRLF; line endings are not drift.
			committed = readFileSync(defaultOutput, 'utf8').replace(/\r\n/g, '\n');
		} catch {
			// A missing module is stale by definition.
		}
		if (committed !== moduleText) {
			process.stderr.write('tokens.ts is stale: run `npm run tokens` and commit the result.\n');
			return 1;
		}
		return 0;
	}
	writeFileSync(defaultOutput, moduleText);
	return 0;
}

/** Node resolves symlinks in `import.meta.url` but not in `argv[1]`, so compare real paths. */
function isMainModule() {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isMainModule()) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof TokenError)) throw error;
		process.stderr.write(`generate-tokens: ${error.message}\n`);
		process.exitCode = 2;
	}
}
