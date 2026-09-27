import * as fs from 'fs';
import * as path from 'path';
import cardsFile from '../../data/cards.json';
import { CardData, CardEffect } from '../../mechanics/Card';

/**
 * DDB-171: the strategies scored effect types no card uses (speed,
 * move_to_position, position_change), so MCTS never valued a real Flank or
 * Nitro Boost. This reads every AI source file for the effect types and
 * statuses it checks and fails on any the card data doesn't have.
 */

const AI_DIR = path.join(__dirname, '..');

const allEffects = (effects: CardEffect[]): CardEffect[] =>
	effects.flatMap(effect => [effect, ...(effect.effect ? allEffects([effect.effect]) : [])]);

const cardEffects = allEffects((cardsFile as unknown as { cards: CardData[] }).cards.flatMap(card => card.effects));
const cardEffectTypes = new Set(cardEffects.map(effect => effect.type));
const cardStatuses = new Set(cardEffects.map(effect => effect.status).filter((status): status is string => typeof status === 'string'));

const quoted = (text: string): string[] => [...text.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);

/**
 * The effect types a source file compares an effect's type against: `e.type
 * === 'x'`, `['x', 'y'].includes(e.type)`, and the case labels of a `switch
 * (effect.type)`
 */
function checkedEffectTypes(source: string): string[] {
	const compared = [...source.matchAll(/\b(?:e|effect)\.type\s*[!=]==\s*'([a-z_]+)'/g)].map(match => match[1]);
	const included = [...source.matchAll(/\[([^\]]*)\]\.includes\(\s*(?:e|effect)\.type\s*\)/g)].flatMap(match => quoted(match[1]));
	const switched = [...source.matchAll(/switch\s*\(\s*(?:e|effect)\.type\s*\)\s*\{/g)].flatMap(match => {
		let depth = 1;
		let end = (match.index ?? 0) + match[0].length;
		while (depth > 0 && end < source.length) {
			if (source[end] === '{') depth++;
			if (source[end] === '}') depth--;
			end++;
		}
		const body = source.slice((match.index ?? 0) + match[0].length, end);
		return [...body.matchAll(/case\s+'([a-z_]+)'\s*:/g)].map(label => label[1]);
	});
	return [...compared, ...included, ...switched];
}

function checkedStatuses(source: string): string[] {
	return [...source.matchAll(/\b(?:e|effect)\.status\s*[!=]==\s*'([a-z_]+)'/g)].map(match => match[1]);
}

const sources = fs.readdirSync(AI_DIR)
	.filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
	.map(file => ({ file, source: fs.readFileSync(path.join(AI_DIR, file), 'utf8') }));

describe('the AI strategies only check effect types the cards use', () => {
	test('the scan finds the checks it should', () => {
		const mcts = sources.find(({ file }) => file === 'MCTSAI.ts');
		expect(mcts && checkedEffectTypes(mcts.source)).toEqual(expect.arrayContaining(['damage', 'change_position', 'apply_status', 'draw_cards']));
		const salvage = sources.find(({ file }) => file === 'SalvageAI.ts');
		expect(salvage && checkedStatuses(salvage.source)).toContain('speed_reduction');
	});

	test.each(sources.map(({ file, source }) => [file, source]))('%s', (_file, source) => {
		expect(checkedEffectTypes(source).filter(type => !cardEffectTypes.has(type))).toEqual([]);
		expect(checkedStatuses(source).filter(status => !cardStatuses.has(status))).toEqual([]);
	});
});
