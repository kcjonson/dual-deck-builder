import { Card, CardData, CardEffect } from '../mechanics/Card';
import { EFFECT_TARGETS } from '../mechanics/EffectTargets';
import cardsFile from './cards.json';

/**
 * Card data check (Card System Design 1.1, Battle Screen Design 5 and 8).
 * Over budget is a content bug: rewrite the text, never shrink the type.
 */

// Full text in the detail view, measured at about 357 characters with a two-line name.
const DESCRIPTION_MAX_CHARS = 330;

// Stand-in for "three lines of 12px text in a 114px box" until phase 2 text
// measurement lands and this becomes a real wrap check. Counted as rendered,
// so keyword brackets don't count. The longest current summary is 59.
const SUMMARY_MAX_CHARS = 60;

const renderedSummary = (text: string): string => text.replace(/\[(.+?)\]/g, '$1');

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

describe('card data check', () => {
	it.each(texts)('$label description fits the detail view', ({ description }) => {
		expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
	});

	it.each(texts)('$label summary fits the card face', ({ summary }) => {
		expect(renderedSummary(summary).length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
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
		const leaves = (effect: CardEffect): CardEffect[] => effect.effect ? leaves(effect.effect) : [effect];
		for (const effect of effects.flatMap(leaves)) {
			expect(EFFECT_TARGETS).toContain(effect.target);
		}
	});

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

	it('the summary proxy rejects full rules text used as a summary', () => {
		const headshot = texts.find((t) => t.label === 'headshot');
		expect(headshot).toBeDefined();
		expect(renderedSummary(headshot?.description ?? '').length).toBeGreaterThan(SUMMARY_MAX_CHARS);
	});
});
