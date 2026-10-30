import type { Card, CardEffect } from './Card';
import type { SwerveDirection } from './Road';

/**
 * What a change_position effect does (Combat Rules, Swerving; the card data
 * shape is in docs/AI_TECHNICAL_DECISIONS/movement-cards.md):
 *
 * - `flanking`: onto the other team's shoulder, outrunning the card's target.
 * - `swerve`: one step to an adjacent empty slot in the mover's formation.
 * - `move`: to a named slot further than one step, under the same slot rules.
 * - `swap`: the caster and the card's target trade slots.
 * - `drop_back`: a flanker back to its reserved slot.
 * - `formation_shift`: every vehicle in the caster's formation to the other
 *   lane in its row, flankers' reservations with them.
 */
export type MovePosition = 'flanking' | 'swerve' | 'move' | 'swap' | 'drop_back' | 'formation_shift';

/** Where a swerve goes: a fixed direction, any adjacent slot the player picks, or a picked row ahead or behind. */
export type SwerveTo = SwerveDirection | 'pick' | 'pick_row';

/** Where a move goes: any empty formation slot the player picks, or the slot behind the mover's partner. */
export type MoveTo = 'pick' | 'behind_partner';

/** Who a move effect moves: the caster's vehicle, or the card's target. */
export type Mover = 'caster' | 'target';

/**
 * A change_position effect read into one shape. `optional` moves are
 * skipped when they have nowhere legal to go and the rest of the card still
 * plays; any other move with nowhere to go makes the card unplayable (call
 * 285), and failing when it resolves cancels the rest of the card, as a
 * failed flank does.
 */
export type MoveSpec =
	| { kind: 'flanking' }
	| { kind: 'swerve'; mover: Mover; to: SwerveTo; optional: boolean }
	| { kind: 'move'; mover: Mover; to: MoveTo; optional: boolean }
	| { kind: 'swap'; optional: boolean }
	| { kind: 'drop_back'; mover: Mover; optional: boolean }
	| { kind: 'formation_shift' };

const SWERVE_TO: readonly SwerveTo[] = ['other_lane', 'outside', 'ahead', 'behind', 'pick', 'pick_row'];
const MOVE_TO: readonly MoveTo[] = ['pick', 'behind_partner'];

function moverOf(effect: CardEffect): Mover {
	if (effect.target === undefined || effect.target === 'self') return 'caster';
	if (effect.target === 'target') return 'target';
	throw new Error(`change_position target must be "self" or "target", not "${String(effect.target)}"`);
}

/**
 * Read a change_position effect, throwing on card data that doesn't say a
 * move the battle knows. Card data is checked against this (cards.test.ts),
 * so a bad move fails there, not mid-fight.
 */
export function moveSpecOf(effect: CardEffect): MoveSpec {
	if (effect.type !== 'change_position') {
		throw new Error(`${effect.type} is not a change_position effect`);
	}
	const optional = effect.optional === true;
	switch (effect.position) {
		case 'flanking':
			if (moverOf(effect) !== 'caster') throw new Error('a flank moves whoever acts, so its target is "self"');
			return { kind: 'flanking' };
		case 'swerve': {
			const to = effect.to as SwerveTo;
			if (!SWERVE_TO.includes(to)) throw new Error(`a swerve goes ${SWERVE_TO.join(', ')}, not "${String(effect.to)}"`);
			return { kind: 'swerve', mover: moverOf(effect), to, optional };
		}
		case 'move': {
			const to = effect.to as MoveTo;
			if (!MOVE_TO.includes(to)) throw new Error(`a move goes ${MOVE_TO.join(', ')}, not "${String(effect.to)}"`);
			return { kind: 'move', mover: moverOf(effect), to, optional };
		}
		case 'swap':
			if (moverOf(effect) !== 'target') throw new Error('a swap trades slots with the card\'s target, so its target is "target"');
			return { kind: 'swap', optional };
		case 'drop_back':
			return { kind: 'drop_back', mover: moverOf(effect), optional };
		case 'formation_shift':
			if (moverOf(effect) !== 'caster') throw new Error('a formation shift moves the caster\'s formation, so its target is "self"');
			return { kind: 'formation_shift' };
		default:
			throw new Error(`change_position position "${String(effect.position)}" is not a move the battle knows`);
	}
}

/** Every change_position effect on a card, read, in order. */
export function movesOf(card: Card): MoveSpec[] {
	return card.effects.filter(effect => effect.type === 'change_position').map(moveSpecOf);
}

/**
 * Whether a move needs a slot picked when the card is played: Juke and
 * Strafe's adjacent slot, Bootlegger Turn and Fall In's formation slot,
 * Shoulder Check's row
 */
export function picksSlot(move: MoveSpec): move is PickedMove {
	return (move.kind === 'swerve' || move.kind === 'move') && (move.to === 'pick' || move.to === 'pick_row');
}

/** A swerve or move whose destination the player picks */
export type PickedMove = Extract<MoveSpec, { kind: 'swerve' | 'move' }>;

/**
 * The move a card's picked destination is for, or null when it picks none.
 * A card picks at most one slot.
 */
export function pickedMoveOf(card: Card): PickedMove | null {
	const picked = movesOf(card).filter(picksSlot);
	if (picked.length > 1) throw new Error(`${card.name} picks more than one slot`);
	return picked[0] ?? null;
}

/** Whether playing the card needs a destination slot (DDB-548's slot targeting). */
export function cardPicksSlot(card: Card): boolean {
	return pickedMoveOf(card) !== null;
}

/**
 * The caster's own swerve or move that its other effects follow, so a
 * card's range is measured from where it lands (Strafe, Cut Off), or null
 */
export function casterMoveOf(card: Card): Extract<MoveSpec, { kind: 'swerve' | 'move' }> | null {
	for (const move of movesOf(card)) {
		if ((move.kind === 'swerve' || move.kind === 'move') && move.mover === 'caster') return move;
	}
	return null;
}
