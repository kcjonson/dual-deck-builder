import type { Card, CardEffect } from './Card';
import type { Driver } from './Driver';
import type { Vehicle } from './Vehicle';
import type { RoadSlot } from './Road';
import { EffectRecipient, effectRecipientOf } from './EffectTargets';

/**
 * What a raider is about to do, as the player sees it.
 * See docs/specs/AI System Technical Design.md section 6.1.
 */
export enum IntentType {
	ATTACK = 'attack',
	DEFEND = 'defend',
	BUFF = 'buff',
	DEBUFF = 'debuff',
	UNKNOWN = 'unknown'
}

/**
 * How much of a raider's plan the player gets to see. Basic raiders show
 * everything; elites hide the value. Bosses behave like elites until bosses
 * are designed. See AI System Technical Design section 6.2.
 */
export enum IntentTier {
	BASIC = 'basic',
	ELITE = 'elite',
	BOSS = 'boss'
}

/**
 * A target vehicle id, 'both' for an area hit on the whole convoy, or null
 * for a move with no target (armor, self buffs).
 */
export type IntentTarget = string | 'both' | null;

/**
 * One card a raider committed to at the start of the player's turn. The
 * enemy turn plays these in order instead of choosing fresh.
 */
export interface PlannedAction {
	card: Card;
	driver: Driver;
	target: Vehicle | null;
	/** The raider's projected slot, flank state, and speed when this card resolves, after its earlier planned cards. */
	slot: RoadSlot | null;
	flanking: boolean;
	speed: number;
}

export interface Intent {
	type: IntentType;
	/** Damage per hit, or armor or repair gained. Null when there's no number or the tier hides it. */
	amount: number | null;
	/** Multi-hit count; "6x3" is amount 6, hits 3. Always 1 until card data needs more. */
	hits: number;
	/** The status or move a buff or debuff applies ("speed_reduction", "flank"). Null when hidden. */
	label: string | null;
	target: IntentTarget;
	/** The card name, or "???" when the tier hides it. */
	description: string;
}

const isSelfEffect = (effect: CardEffect, card: Card): boolean =>
	effectRecipientOf({ effect, card }) === EffectRecipient.CASTER;

const isStatusEffect = (effect: CardEffect): boolean =>
	effect.type === 'apply_status' || effect.type === 'status';

/**
 * The first effect that hurts the other side, if any. Self damage
 * (Berserker) doesn't count.
 */
export function attackEffectOf(card: Card): CardEffect | null {
	return card.effects.find(effect => effect.type === 'damage' && !isSelfEffect(effect, card)) ?? null;
}

/**
 * Classify a card by what it does to the board, strongest first: any damage
 * to the other side is an attack, a status on the other side is a debuff,
 * armor or repair is defend, anything else the raider does for itself is a
 * buff.
 */
export function intentTypeOf(card: Card): IntentType {
	if (attackEffectOf(card)) return IntentType.ATTACK;
	if (card.effects.some(effect => isStatusEffect(effect) && !isSelfEffect(effect, card))) {
		return IntentType.DEBUFF;
	}
	if (card.effects.some(effect => ['gain_armor', 'armor', 'heal', 'heal_driver'].includes(effect.type))) {
		return IntentType.DEFEND;
	}
	if (buffLabelOf(card)) return IntentType.BUFF;
	return IntentType.UNKNOWN;
}

/**
 * Armor or repair a defend card grants.
 */
export function defendAmountOf(card: Card): number | null {
	const effect = card.effects.find(e => ['gain_armor', 'armor', 'heal', 'heal_driver'].includes(e.type));
	return typeof effect?.value === 'number' ? effect.value : null;
}

export function debuffLabelOf(card: Card): string | null {
	const effect = card.effects.find(e => isStatusEffect(e) && !isSelfEffect(e, card));
	return effect?.status ?? null;
}

export function buffLabelOf(card: Card): string | null {
	for (const effect of card.effects) {
		if (effect.type === 'change_position') return 'flank';
		if (isStatusEffect(effect)) return effect.status ?? null;
		if (effect.type === 'gain_resource' || effect.type === 'adrenaline') return effect.resource ?? 'adrenaline';
		if (effect.type === 'draw_cards' || effect.type === 'draw') return 'draw';
	}
	return null;
}

/**
 * The value as the pill prints it: "15", "6x3", "speed_reduction", or "?"
 * when there is nothing to show.
 */
export function formatIntentValue(intent: Intent): string {
	if (intent.amount !== null) {
		return intent.hits > 1 ? `${intent.amount}x${intent.hits}` : `${intent.amount}`;
	}
	return intent.label ?? '?';
}
