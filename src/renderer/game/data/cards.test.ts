import { Card, CardData, CardEffect } from '../mechanics/Card';
import { EFFECT_TARGETS } from '../mechanics/EffectTargets';
import cardsFile from './cards.json';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Card as UICard, FACE_RULES } from '../ui/Card';
import { KEYWORDS, keywordPieces } from './keywords';

/**
 * Card data check (Card System Design 1.1, Battle Screen Design 5 and 8).
 * Over budget is a content bug: rewrite the text, never shrink the type.
 */

// Full text in the detail view, measured at about 357 characters with a two-line name.
const DESCRIPTION_MAX_CHARS = 330;

// The card face's short text gets three lines of 12 px over 17 in a 114 px
// box (Battle Screen Design, card text table), measured as the face lays it
// out, keyword by keyword, with the committed faces.
const SUMMARY_MAX_LINES = FACE_RULES.maxLines;

let context: MountContext;

const summaryLines = (summary: string): number => {
	const face = new UICard({ x: 0, y: 0, data: new Card({ ...cards[0], summary }) });
	// Mounted, so its words measure through the context (R1.6).
	face.mount(context);
	const lines = face.summaryLines;
	face.unmount();
	if (lines === 0) throw new Error('summary text could not be measured');
	return lines;
};

const cards = (cardsFile as unknown as { cards: CardData[] }).cards;

const texts = cards.flatMap((data) =>
	[false, true].map((upgraded) => {
		const card = new Card({ ...data, upgraded });
		return {
			label: `${data.type}${upgraded ? '+' : ''}`,
			summary: card.displaySummary,
			description: card.displayDescription,
		};
	})
);

// A wrapper (conditional) carries its target and its numbers in the effect it wraps
const leaves = (effect: CardEffect): CardEffect[] => effect.effect ? leaves(effect.effect) : [effect];

type PrintedField = 'value' | 'hit_modifier';

/**
 * Which effects a text variable can print its number from, by the variable's
 * name, and the field. Of those, it prints the ones holding its base value,
 * so Precision Shot's {damage} and {bonus} each find their own hit, and
 * Coordinated Attack's {damage} finds both of its. Flag Down's {slow} prints
 * its -2 as 2.
 */
const PRINTED_FROM: Record<string, { from: (effect: CardEffect) => boolean; field: PrintedField; sign: 1 | -1 }> = {
	damage: { from: (effect) => effect.type === 'damage', field: 'value', sign: 1 },
	bonus: { from: (effect) => effect.type === 'damage' || effect.status === 'damage_bonus', field: 'value', sign: 1 },
	hit_modifier: { from: (effect) => effect.type === 'damage', field: 'hit_modifier', sign: 1 },
	healing: { from: (effect) => effect.type === 'heal' || effect.type === 'heal_driver', field: 'value', sign: 1 },
	armor: { from: (effect) => effect.type === 'gain_armor', field: 'value', sign: 1 },
	shield: { from: (effect) => effect.type === 'gain_shield', field: 'value', sign: 1 },
	cards: { from: (effect) => effect.type === 'draw_cards', field: 'value', sign: 1 },
	adrenaline: { from: (effect) => effect.resource === 'adrenaline' || effect.type === 'grant_adrenaline', field: 'value', sign: 1 },
	speed: { from: (effect) => effect.status === 'speed_boost', field: 'value', sign: 1 },
	slow: { from: (effect) => effect.status === 'speed_reduction', field: 'value', sign: -1 },
};

/** Each of a card's text variables, with where its number sits among the card's leaf effects. */
const variablesOf = (data: CardData) => Object.entries(data.variables ?? {}).map(([name, { base, upgraded = base }]) => {
	const rule = PRINTED_FROM[name];
	if (!rule) throw new Error(`nothing says which effects {${name}} prints from: add it to PRINTED_FROM`);
	const printed = data.effects.flatMap(leaves).flatMap((effect, leaf) =>
		rule.from(effect) && effect[rule.field] === rule.sign * base ? [{ leaf, field: rule.field, sign: rule.sign }] : []);
	return { name, base, upgraded, printed };
});

/** The effects an upgraded copy should play: the base ones, each printed number at its upgraded value. */
const upgradedEffects = (data: CardData): CardEffect[] => {
	const effects: CardEffect[] = JSON.parse(JSON.stringify(data.effects));
	const effectLeaves = effects.flatMap(leaves);
	for (const { upgraded, printed } of variablesOf(data)) {
		for (const { leaf, field, sign } of printed) effectLeaves[leaf][field] = sign * upgraded;
	}
	return effects;
};

// Upgrades still out of step with their text, left for a design call.
// Headshot's text says its upgrade deals 10, and the upgrade deals 2 (Combat
// Rules says 2, upgraded or not; the base card deals 5). Ram's text keeps
// Armor/10 when its upgrade plays Armor/7 plus twice the speed gap. Each
// fails the upgrade check until it's fixed, when `.failing` says to take it
// off this list.
const OUT_OF_STEP = new Set(['headshot', 'ram']);

describe('card data check', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it.each(texts)('$label description fits the detail view', ({ description }) => {
		expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
	});

	it.each(texts)('$label summary fits the card face in three lines', ({ summary }) => {
		expect(summaryLines(summary)).toBeLessThanOrEqual(SUMMARY_MAX_LINES);
	});

	it.each(texts)('$label summary brackets only words the keyword boxes can explain', ({ summary }) => {
		for (const piece of keywordPieces(summary, 'bracketed')) {
			if (piece.keyword) expect(Object.keys(KEYWORDS)).toContain(piece.text);
		}
	});

	it('measures the summary at the face\'s 12 px in 114 px', () => {
		expect(FACE_RULES).toEqual({ width: 114, fontSize: 12, lineHeight: 17, maxLines: 3 });
	});

	it.each(texts)('$label has no unfilled {variables}', ({ summary, description }) => {
		expect(summary).not.toMatch(/\{\w+\}/);
		expect(description).not.toMatch(/\{\w+\}/);
	});

	// Every effect says who it lands on. A wrapper (conditional) says it through
	// the effect it wraps. Upgrades replace the whole effects array, so they count.
	const upgradeEffects = (data: CardData): CardEffect[] => {
		const effects = data.upgrades?.effects;
		return Array.isArray(effects) ? effects : [];
	};
	it.each(cards.map((data) => ({ label: data.type, effects: [...data.effects, ...upgradeEffects(data)] })))('$label effects each name a target the battle knows', ({ effects }) => {
		for (const effect of effects.flatMap(leaves)) {
			expect(EFFECT_TARGETS).toContain(effect.target);
		}
	});

	// The text and the effects agree on every number the text prints
	it.each(cards.flatMap((data) => variablesOf(data).map(({ name, printed }) => ({ label: `${data.type} {${name}}`, printed }))))('$label prints a number its effects carry', ({ printed }) => {
		expect(printed).not.toHaveLength(0);
	});

	// Upgraded, a card plays the numbers its upgraded text prints and changes
	// nothing its text leaves out, whether upgrade() made it or it was built
	// upgraded, as the gallery's sample cards are.
	const upgradeCases = cards.map((data) => ({ label: data.type, data }));
	const playsItsUpgradedText = ({ data }: { data: CardData }): void => {
		const expected = upgradedEffects(data);
		expect(new Card({ ...data }).upgrade().effects).toEqual(expected);
		expect(new Card({ ...data, upgraded: true }).effects).toEqual(expected);
	};
	it.each(upgradeCases.filter(({ data }) => !OUT_OF_STEP.has(data.type)))('$label upgraded plays the numbers its upgraded text prints', playsItsUpgradedText);
	it.failing.each(upgradeCases.filter(({ data }) => OUT_OF_STEP.has(data.type)))('$label upgraded still plays what its text doesn\'t say', playsItsUpgradedText);

	// Battle.checkHit adds hit_modifier to the defender's evade, so positive is harder
	it('Headshot raises the defender\'s evade by 2, and by 1 once upgraded', () => {
		const data = cards.find((c) => c.type === 'headshot');
		expect(data).toBeDefined();
		if (!data) return;
		const base = new Card({ ...data });
		const upgraded = new Card({ ...data }).upgrade();

		expect(base.effects[0].hit_modifier).toBe(2);
		expect(upgraded.effects[0].hit_modifier).toBe(1);
		expect(base.displaySummary).toContain('Target gets +2 Evade');
		expect(upgraded.displaySummary).toContain('Target gets +1 Evade');
		expect(upgraded.displayDescription).toContain('(+1 to defender\'s evade)');
	});

	it('the summary check rejects full rules text used as a summary', () => {
		const headshot = texts.find((t) => t.label === 'headshot');
		expect(headshot).toBeDefined();
		expect(summaryLines(headshot?.description ?? '')).toBeGreaterThan(SUMMARY_MAX_LINES);
	});
});
