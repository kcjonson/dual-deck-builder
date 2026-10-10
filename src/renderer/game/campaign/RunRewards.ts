import type { Rng, WeightedEntry } from '../core/Rng';
import cardsFile from '../data/cards.json';

/**
 * The card reward after a won fight on the MVP supply run (DDB-454): a
 * choice of cards from the reward pool, picked one or skipped. Decision
 * record: docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md.
 */

/** Cards offered after a won fight. */
export const REWARD_CHOICES = 3;

const REWARD_RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
type RewardRarity = (typeof REWARD_RARITIES)[number];

/** Card System Design 1.2's drop rates. */
const RARITY_WEIGHTS: Readonly<Record<RewardRarity, number>> = { common: 60, uncommon: 30, rare: 9, legendary: 1 };

interface PoolCard {
	readonly type: string;
	readonly rarity: RewardRarity;
	readonly order: boolean;
}

/**
 * Every card a reward can offer, in cards.json's order: no escort's
 * signature card, and nothing outside the four drop rarities.
 */
const REWARD_POOL: readonly PoolCard[] = (cardsFile.cards as readonly { type: string; rarity: string; tags?: readonly string[] }[])
	.filter((card): card is { type: string; rarity: RewardRarity; tags?: readonly string[] } => (REWARD_RARITIES as readonly string[]).includes(card.rarity))
	.map(card => Object.freeze({ type: card.type, rarity: card.rarity, order: card.tags?.includes('order') ?? false }));

/**
 * `REWARD_CHOICES` different card types: each a rarity drawn at the drop
 * rates among those with a card left to offer, then a card of it. Order
 * cards are in the pool only while the convoy has an escort (Card System
 * Design 1.3). Draws only from `rng`, so a fight's reward is the same
 * however often it's rolled.
 */
export function rollRewardCards({ rng, ownsEscort }: { rng: Rng; ownsEscort: boolean }): readonly string[] {
	let pool = REWARD_POOL.filter(card => ownsEscort || !card.order);
	const picks: string[] = [];
	while (picks.length < REWARD_CHOICES && pool.length > 0) {
		const rarities: WeightedEntry<RewardRarity>[] = REWARD_RARITIES
			.filter(rarity => pool.some(card => card.rarity === rarity))
			.map(rarity => ({ value: rarity, weight: RARITY_WEIGHTS[rarity] }));
		const rarity = rng.weighted(rarities);
		const pick = rng.pick(pool.filter(card => card.rarity === rarity));
		picks.push(pick.type);
		pool = pool.filter(card => card !== pick);
	}
	return Object.freeze(picks);
}
