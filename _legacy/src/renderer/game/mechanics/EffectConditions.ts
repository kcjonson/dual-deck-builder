import type { CardEffect } from './Card';
import { ROW_ORDER, RoadRow, RoadSlot } from './Road';

/**
 * A board condition a card effect can ask (Combat Rules, Movement cards).
 * Card data names one as a string, read by boardConditionOf, which throws on
 * one the battle doesn't know; the card data check runs it over cards.json.
 *
 * - `caster_row_<ahead|center|behind>`: the caster's vehicle is in that row
 *   (Point Man's `caster_row_ahead`).
 * - `target_row_<ahead|behind|same>`: the target is in a row ahead of,
 *   behind, or level with the caster's (Tail Gunner's `target_row_ahead`).
 * - `caster_swerved`: the caster's vehicle has changed slot this turn
 *   (Weave; call 290 says what counts).
 *
 * Rows count on every lane, a shoulder's included (call 310).
 */
export type BoardCondition =
	| { kind: 'caster_row'; row: RoadRow }
	| { kind: 'target_row'; relation: RowRelation }
	| { kind: 'caster_swerved' };

/** Where the target's row is against the caster's. */
export type RowRelation = 'ahead' | 'behind' | 'same';

const ROW_RELATIONS: readonly RowRelation[] = ['ahead', 'behind', 'same'];

/** What a condition reads: both vehicles' slots, and whether the caster's has changed slot this turn. */
export interface ConditionBoard {
	casterSlot: RoadSlot | null;
	targetSlot: RoadSlot | null;
	casterSwerved: boolean;
}

/** Read a condition's name, throwing on one the battle doesn't know. */
export function boardConditionOf(name: string): BoardCondition {
	if (name === 'caster_swerved') return { kind: 'caster_swerved' };
	const casterRow = /^caster_row_(\w+)$/.exec(name)?.[1];
	if (casterRow !== undefined) {
		const row = ROW_ORDER.find(candidate => candidate === casterRow);
		if (!row) throw new Error(`"${name}" names no row: caster_row_ takes ${ROW_ORDER.join(', ')}`);
		return { kind: 'caster_row', row };
	}
	const targetRow = /^target_row_(\w+)$/.exec(name)?.[1];
	if (targetRow !== undefined) {
		const relation = ROW_RELATIONS.find(candidate => candidate === targetRow);
		if (!relation) throw new Error(`"${name}" names no relation: target_row_ takes ${ROW_RELATIONS.join(', ')}`);
		return { kind: 'target_row', relation };
	}
	throw new Error(`"${name}" is not a condition the battle knows`);
}

export function conditionHolds(condition: BoardCondition, board: ConditionBoard): boolean {
	switch (condition.kind) {
		case 'caster_row':
			return board.casterSlot?.row === condition.row;
		case 'target_row': {
			if (!board.casterSlot || !board.targetSlot) return false;
			// ROW_ORDER runs ahead to behind, so a row ahead has the lower index
			const apart = ROW_ORDER.indexOf(board.targetSlot.row) - ROW_ORDER.indexOf(board.casterSlot.row);
			if (condition.relation === 'same') return apart === 0;
			return condition.relation === 'ahead' ? apart < 0 : apart > 0;
		}
		case 'caster_swerved':
			return board.casterSwerved;
	}
}

/**
 * An effect's conditional bonus: `bonus` added to its value while
 * `bonus_condition` holds, or null for an effect without one. Throws on a
 * half-written pair, or a condition the battle doesn't know.
 */
export function effectBonusOf(effect: CardEffect): { bonus: number; condition: BoardCondition } | null {
	const { bonus, bonus_condition: condition } = effect;
	if (bonus === undefined && condition === undefined) return null;
	if (typeof bonus !== 'number' || typeof condition !== 'string') {
		throw new Error(`${effect.type} needs both a numeric bonus and a bonus_condition, or neither`);
	}
	return { bonus, condition: boardConditionOf(condition) };
}

/** What an effect's bonus adds on this board: its `bonus` while its `bonus_condition` holds, otherwise 0. */
export function effectBonus(effect: CardEffect, board: ConditionBoard): number {
	const bonus = effectBonusOf(effect);
	return bonus && conditionHolds(bonus.condition, board) ? bonus.bonus : 0;
}

/**
 * The value an effect lands with: its `value`, plus its `bonus` when its
 * `bonus_condition` holds (Point Man's +3 from the ahead row, Tail Gunner's
 * +2 on a target ahead, Weave's +1 Evade after a swerve). Play, the planning
 * projection, and the aim preview all read it, so they agree.
 */
export function effectValue(effect: CardEffect, board: ConditionBoard): number {
	return (typeof effect.value === 'number' ? effect.value : 0) + effectBonus(effect, board);
}
