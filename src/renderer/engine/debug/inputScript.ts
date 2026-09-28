/**
 * R13.35's injection grammar, parsed.
 *
 * Pure: no DOM, no window, no engine state, so this file's tests run in the
 * suite's default node environment and the grammar is provable without a
 * browser (R13.4). Dispatch lives next door in inputInjection.ts, the same way
 * treeSnapshot and layoutLint are split from the hooks that install them.
 *
 * The grammar, R13.35's verbs with R9.25's pointer fields:
 *
 *   move,x,y[,pointerId[,pointerType]]
 *   down,x,y[,button[,pointerId[,pointerType]]]
 *   up,x,y[,button[,pointerId[,pointerType]]]
 *   click,x,y[,button[,pointerId[,pointerType]]]   expands to move, then down, then up
 *   cancel[,pointerId]
 *   scroll,x,y,delta
 *   keydown,<key>
 *   keyup,<key>
 *
 * The pointer fields are positional and trail the existing ones, so every
 * command R13.35 wrote still parses to the same thing: `pointerId` defaults
 * to 1. An omitted `pointerType` is left out of the step, and the dispatch
 * side takes the type that pointer last had (its down's, for an up), or
 * `mouse` for a pointer it has never seen, since a real pointer does not
 * change type mid-gesture. The cost
 * of positional is that a touch press spells out its button,
 * `down,10,20,0,2,touch`; named fields would be a second syntax for a
 * grammar whose appeal is that it has one.
 *
 * `cancel` is the platform abandoning a gesture (R9.1, R15.39): the pointer's
 * press and capture reset and no click follows. It takes no coordinates
 * because the dispatcher's cancel uses none; the dispatch side sends it
 * where that pointer last was.
 *
 * `x` and `y` are logical pixels in the space window.__ui.tree() reports
 * (R7.1, R7.15): CSS pixels from the top-left of the canvas, never multiplied
 * by devicePixelRatio.
 *
 * `click` is the only verb that expands, and the expansion is done here so it
 * is testable without a DOM. R13.35 spelling out that expansion is also what
 * settles the question for the others: `down,x,y` does NOT imply a move, or
 * click's three-step expansion would be redundant.
 *
 * Parsing rules, chosen once and applied everywhere:
 *
 * - The verb is trimmed and lowercased. Coordinates are trimmed. A key is taken
 *   verbatim from the character after the first comma, because `,` and ` ` are
 *   both real key names: `keydown,,` sends the comma key and `keydown, ` the
 *   space bar. Trimming the key would make the space bar unreachable.
 * - A number must be finite. `Number('')` is 0 in JavaScript, so an empty
 *   field is rejected before it can silently become the origin.
 * - `pointerId` is a non-negative integer. `pointerType` is `mouse`, `touch`
 *   or `pen`, case-insensitive; `virtual` is the controller's type (R9.1) and
 *   never arrives through the pointer adapter, so it is not injectable here.
 * - `button` defaults to 0 and must otherwise be an integer from 0 to 4.
 *   The upper bound is the dispatcher's: `MouseEvent.buttons` has a bit for
 *   each of those five and no more, so a button 9 would dispatch a mousedown
 *   whose buttons mask says nothing is held during a press.
 * - Extra fields are an error rather than ignored, so `move,1,2,3` fails loudly
 *   instead of quietly doing something other than what it says.
 * - Nothing throws. Every rejection comes back as `{ ok: false, error }`; a
 *   harness that mistypes one command gets a message, not a stack trace.
 */

/** The pointer types a DOM PointerEvent can carry (R9.1). */
export type InjectedPointerType = 'mouse' | 'touch' | 'pen';

interface PointerFields {
	x: number;
	y: number;
	pointerId: number;
	/** Absent when the command named none: the pointer's own type, or `mouse` (see above). */
	pointerType?: InjectedPointerType;
}

export type InjectedStep =
	| ({ kind: 'move' } & PointerFields)
	| ({ kind: 'down'; button: number } & PointerFields)
	| ({ kind: 'up'; button: number } & PointerFields)
	| { kind: 'cancel'; pointerId: number }
	| { kind: 'scroll'; x: number; y: number; delta: number }
	| { kind: 'keydown'; key: string }
	| { kind: 'keyup'; key: string };

export type ParsedCommand =
	| { ok: true; steps: InjectedStep[] }
	| { ok: false; error: string };

function fail(error: string): ParsedCommand {
	return { ok: false, error };
}

/**
 * Fields arrive trimmed, so the empty check catches both `move,,5` and a field
 * that was nothing but spaces. Rejecting it matters: Number('') is 0.
 */
function finiteNumber(field: string | undefined): number | null {
	if (field === undefined || field === '') return null;
	const value = Number(field);
	return Number.isFinite(value) ? value : null;
}

/** 0 to 4: MouseEvent.buttons has no bit above 4 (BUTTONS_BIT in inputInjection.ts). */
function buttonNumber(field: string | undefined): number | null {
	if (field === undefined) return 0;
	const value = finiteNumber(field);
	if (value === null || !Number.isInteger(value) || value < 0 || value > 4) return null;
	return value;
}

const POINTER_TYPES: readonly InjectedPointerType[] = ['mouse', 'touch', 'pen'];

function pointerIdNumber(field: string | undefined): number | null {
	if (field === undefined) return 1;
	const value = finiteNumber(field);
	if (value === null || !Number.isInteger(value) || value < 0) return null;
	return value;
}

function pointerTypeName(field: string): InjectedPointerType | null {
	const type = field.toLowerCase();
	return (POINTER_TYPES as readonly string[]).includes(type) ? (type as InjectedPointerType) : null;
}

/** The optional `pointerId[,pointerType]` tail, starting at `fields[index]`. */
function parsePointerTail(
	verb: string,
	fields: string[],
	index: number,
): { pointerId: number; pointerType?: InjectedPointerType } | string {
	const pointerId = pointerIdNumber(fields[index]);
	if (pointerId === null) return `${verb} needs a non-negative integer pointerId, got "${fields[index]}"`;

	const field = fields[index + 1];
	if (field === undefined) return { pointerId };
	const pointerType = pointerTypeName(field);
	if (pointerType === null) return `${verb} needs a pointerType of mouse, touch or pen, got "${field}"`;

	return { pointerId, pointerType };
}

function parsePoint(verb: string, fields: string[]): { x: number; y: number } | string {
	const x = finiteNumber(fields[0]);
	if (x === null) return `${verb} needs a finite x, got "${fields[0] ?? ''}"`;

	const y = finiteNumber(fields[1]);
	if (y === null) return `${verb} needs a finite y, got "${fields[1] ?? ''}"`;

	return { x, y };
}

export function parseInputCommand(command: string): ParsedCommand {
	if (typeof command !== 'string') return fail('command must be a string');

	const separator = command.indexOf(',');
	const head = separator === -1 ? command : command.slice(0, separator);
	const verb = head.trim().toLowerCase();

	if (verb === '') return fail('empty command');

	if (verb === 'keydown' || verb === 'keyup') {
		if (separator === -1) return fail(`${verb} needs a key`);
		const key = command.slice(separator + 1);
		if (key === '') return fail(`${verb} needs a key`);
		return { ok: true, steps: [{ kind: verb, key }] };
	}

	const fields = separator === -1 ? [] : command.slice(separator + 1).split(',').map((field) => field.trim());

	switch (verb) {
		case 'move': {
			if (fields.length < 2 || fields.length > 4) {
				return fail(`move takes x,y[,pointerId[,pointerType]] (got ${fields.length} argument(s))`);
			}
			const point = parsePoint(verb, fields);
			if (typeof point === 'string') return fail(point);
			const pointer = parsePointerTail(verb, fields, 2);
			if (typeof pointer === 'string') return fail(pointer);
			return { ok: true, steps: [{ kind: 'move', ...point, ...pointer }] };
		}
		case 'down':
		case 'up':
		case 'click': {
			if (fields.length < 2 || fields.length > 5) {
				return fail(`${verb} takes x,y[,button[,pointerId[,pointerType]]] (got ${fields.length} argument(s))`);
			}
			const point = parsePoint(verb, fields);
			if (typeof point === 'string') return fail(point);
			const button = buttonNumber(fields[2]);
			if (button === null) return fail(`${verb} needs an integer button from 0 to 4, got "${fields[2]}"`);
			const pointer = parsePointerTail(verb, fields, 3);
			if (typeof pointer === 'string') return fail(pointer);
			if (verb !== 'click') return { ok: true, steps: [{ kind: verb, ...point, button, ...pointer }] };
			return {
				ok: true,
				steps: [
					{ kind: 'move', ...point, ...pointer },
					{ kind: 'down', ...point, button, ...pointer },
					{ kind: 'up', ...point, button, ...pointer },
				],
			};
		}
		case 'cancel': {
			if (fields.length > 1) return fail(`cancel takes [pointerId] (got ${fields.length} argument(s))`);
			const pointerId = pointerIdNumber(fields[0]);
			if (pointerId === null) return fail(`cancel needs a non-negative integer pointerId, got "${fields[0]}"`);
			return { ok: true, steps: [{ kind: 'cancel', pointerId }] };
		}
		case 'scroll': {
			if (fields.length !== 3) return fail(`scroll takes x,y,delta (got ${fields.length} argument(s))`);
			const point = parsePoint(verb, fields);
			if (typeof point === 'string') return fail(point);
			const delta = finiteNumber(fields[2]);
			if (delta === null) return fail(`scroll needs a finite delta, got "${fields[2]}"`);
			return { ok: true, steps: [{ kind: 'scroll', ...point, delta }] };
		}
		default:
			// The alternatives are named because window.__dev exposes one
			// variadic input(...) and no help surface: a harness author with a
			// console and no copy of R13.35 recovers from the message or not
			// at all.
			return fail(`unknown command "${verb}" (expected move, down, up, click, cancel, scroll, keydown, keyup)`);
	}
}
