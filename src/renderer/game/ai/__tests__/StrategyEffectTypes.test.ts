import * as fs from 'fs';
import * as path from 'path';
import cardsFile from '../../data/cards.json';
import { CardData, CardEffect } from '../../mechanics/Card';

/**
 * DDB-171: the strategies scored effect types no card uses (speed,
 * move_to_position, position_change), so MCTS never valued a real Flank or
 * Nitro Boost. This reads every AI source file for the effect types,
 * statuses, and resources it checks and fails on any the card data doesn't
 * have.
 */

const AI_DIR = path.join(__dirname, '..');

const allEffects = (effects: CardEffect[]): CardEffect[] =>
	effects.flatMap(effect => [effect, ...(effect.effect ? allEffects([effect.effect]) : [])]);

const cardEffects = allEffects((cardsFile as unknown as { cards: CardData[] }).cards.flatMap(card => card.effects));
const stringsOf = (effects: CardEffect[], field: 'type' | 'status' | 'resource'): Set<string> =>
	new Set(effects.map(effect => effect[field]).filter((value): value is string => typeof value === 'string'));

const known = {
	type: stringsOf(cardEffects, 'type'),
	// Only statuses something applies. A status named only in a condition
	// (Precision Shot's speed_plus) is never on anything, so checking for it is dead too.
	status: stringsOf(cardEffects.filter(effect => effect.type === 'apply_status'), 'status'),
	resource: stringsOf(cardEffects, 'resource')
};

type Field = keyof typeof known;

const STRING = String.raw`(?:'([a-z_]+)'|"([a-z_]+)")`;
const RECEIVER = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*`;
// `.type` on these is an AI action or a card id, not an effect type
const NOT_AN_EFFECT = /(?:^|\.)(?:action|bestAction|decision|card)$/;

const quotedIn = (text: string): string[] => [...text.matchAll(new RegExp(STRING, 'g'))].map(match => match[1] ?? match[2]);

/** The text inside the brackets that open at `open`, which must be the opening bracket */
function bracketed(source: string, open: number): string {
	const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
	const closer = pairs[source[open]];
	let depth = 0;
	for (let index = open; index < source.length; index++) {
		if (source[index] === source[open]) depth++;
		if (source[index] === closer) depth--;
		if (depth === 0) return source.slice(open + 1, index);
	}
	return source.slice(open + 1);
}

/** The keys or members a named object, Set, or Map literal in the same source holds */
function namedCollection(source: string, name: string): string[] {
	const definition = new RegExp(String.raw`\b${name}\b[^=;\n]*=\s*(new\s+(?:Set|Map)\s*(?:<[^>]*>)?\s*\(|\{)`).exec(source);
	if (!definition) return [];
	const open = definition.index + definition[0].length - 1;
	const body = bracketed(source, open);
	if (definition[1] === '{') {
		return [...body.matchAll(new RegExp(String.raw`(?:^|[,{\s])(?:${STRING}|([a-z_]+))\s*:`, 'g'))]
			.map(match => match[1] ?? match[2] ?? match[3]);
	}
	return quotedIn(body);
}

/**
 * Every name a source compares a `<something>.<field>` against: == and ===
 * either way round, !=, `[...].includes`, `new Set([...]).has`, a switch's
 * case labels, and lookups in a named object, Set, or Map
 */
function checkedNames(source: string, field: Field): string[] {
	const read = String.raw`(${RECEIVER})\.${field}\b`;
	const counts = (receiver: string): boolean => field !== 'type' || !NOT_AN_EFFECT.test(receiver);
	const names: string[] = [];

	for (const match of source.matchAll(new RegExp(String.raw`${read}\s*[!=]==?\s*${STRING}`, 'g'))) {
		if (counts(match[1])) names.push(match[2] ?? match[3]);
	}
	for (const match of source.matchAll(new RegExp(String.raw`${STRING}\s*[!=]==?\s*${read}`, 'g'))) {
		if (counts(match[3])) names.push(match[1] ?? match[2]);
	}
	for (const match of source.matchAll(new RegExp(String.raw`\[([^\]]*)\]\s*\)?\s*\.(?:includes|has)\(\s*${read}\s*\)`, 'g'))) {
		if (counts(match[2])) names.push(...quotedIn(match[1]));
	}
	for (const match of source.matchAll(new RegExp(String.raw`switch\s*\(\s*${read}\s*\)\s*\{`, 'g'))) {
		if (!counts(match[1])) continue;
		const body = bracketed(source, (match.index ?? 0) + match[0].length - 1);
		names.push(...[...body.matchAll(new RegExp(String.raw`case\s+${STRING}\s*:`, 'g'))].map(label => label[1] ?? label[2]));
	}
	for (const match of source.matchAll(new RegExp(String.raw`([A-Za-z_$][\w$]*)(?:\[\s*|\.(?:get|has)\(\s*)${read}\s*[\])]`, 'g'))) {
		if (counts(match[2])) names.push(...namedCollection(source, match[1]));
	}
	return names;
}

const unknownNames = (source: string): Record<Field, string[]> => ({
	type: checkedNames(source, 'type').filter(name => !known.type.has(name)),
	status: checkedNames(source, 'status').filter(name => !known.status.has(name)),
	resource: checkedNames(source, 'resource').filter(name => !known.resource.has(name))
});

const NONE = { type: [], status: [], resource: [] };

const sources = fs.readdirSync(AI_DIR)
	.filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
	.map(file => ({ file, source: fs.readFileSync(path.join(AI_DIR, file), 'utf8') }));

describe('the AI strategies only check effect types, statuses, and resources the cards use', () => {
	test('only statuses something applies count, not ones named in a condition', () => {
		expect(known.status.has('speed_boost')).toBe(true);
		expect(known.status.has('speed_plus')).toBe(false);
		expect(known.resource).toEqual(new Set(['adrenaline']));
	});

	test('the scan finds the real files\' checks', () => {
		const sourceOf = (file: string): string => sources.find(candidate => candidate.file === file)?.source ?? '';
		expect(checkedNames(sourceOf('MCTSAI.ts'), 'type')).toEqual(expect.arrayContaining(['damage', 'change_position', 'apply_status', 'draw_cards']));
		expect(checkedNames(sourceOf('SalvageAI.ts'), 'status')).toContain('speed_reduction');
		expect(checkedNames(sourceOf('RammingAI.ts'), 'resource')).toContain('adrenaline');
	});

	describe('the scan catches every form a dead check can take', () => {
		test.each([
			['any variable name', 'if (fx.type === \'speed\') {}'],
			['a chained receiver', 'if (this.effect.type === \'speed\') {}'],
			['double quotes', 'if (fx.type === "speed") {}'],
			['loose equality', 'if (x.type == \'speed\') {}'],
			['inequality', 'if (x.type !== \'speed\') {}'],
			['the name first', 'if (\'speed\' === x.type) {}'],
			['an includes list', 'if ([\'damage\', "speed"].includes(fx.type)) {}'],
			['an inline Set', 'if (new Set([\'damage\', \'speed\']).has(fx.type)) {}'],
			['a switch on any variable', 'switch (fx.type) { case \'damage\': break; case "speed": break; }'],
			['an object lookup', 'const WEIGHTS: Record<string, number> = { damage: 1, speed: 2 };\nscore += WEIGHTS[fx.type];'],
			['a quoted object key', 'const WEIGHTS = { \'damage\': 1, \'speed\': 2 };\nscore += WEIGHTS[fx.type] ?? 0;'],
			['a named Set', 'const MOVES = new Set([\'damage\', \'speed\']);\nif (MOVES.has(fx.type)) {}'],
			['a named Map', 'const MOVES = new Map<string, number>([[\'damage\', 1], [\'speed\', 2]]);\nscore += MOVES.get(fx.type) ?? 0;']
		])('%s', (_form, source) => {
			expect(unknownNames(source).type).toEqual(['speed']);
		});

		test('a dead status and a dead resource', () => {
			expect(unknownNames('if (fx.status === "nitro_boost" || fx.resource === \'fuel\') {}')).toEqual({ type: [], status: ['nitro_boost'], resource: ['fuel'] });
		});

		test('a condition-only status', () => {
			expect(unknownNames('if (x.status === \'speed_plus\') {}').status).toEqual(['speed_plus']);
		});

		test('action and card types aren\'t effect types', () => {
			expect(unknownNames('if (action.type === \'playCard\' || bestAction.type === \'endTurn\' || card.type === \'headshot\') {}')).toEqual(NONE);
		});
	});

	test.each(sources.map(({ file, source }) => [file, source]))('%s', (_file, source) => {
		expect(unknownNames(source)).toEqual(NONE);
	});
});
