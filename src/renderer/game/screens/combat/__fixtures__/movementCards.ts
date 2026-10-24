import { Card, CardEffect, TargetType } from '../../../mechanics/Card';

/**
 * Test-only stand-ins for the slot-pick movement cards (DDB-551 builds the
 * real ones), shaped as docs/AI_TECHNICAL_DECISIONS/movement-cards.md's
 * table has them, so slot targeting is tested and demoed from the effects
 * alone and DDB-551 only adds data. Numbers are Combat Rules' first pass;
 * nothing here is in cards.json.
 */
function movementCard({ name, targetType, effects, tags = [], cost = 1 }: {
	name: string;
	targetType: TargetType;
	effects: CardEffect[];
	tags?: string[];
	cost?: number;
}): Card {
	return new Card({
		type: name.toLowerCase().replace(/ /g, '_'),
		name,
		summary: name,
		description: name,
		rarity: 'common',
		cost,
		targetType,
		effects,
		tags,
	});
}

/** Swerve to any adjacent slot, draw 1. */
export const juke = (): Card => movementCard({
	name: 'Juke',
	targetType: 'self',
	effects: [
		{ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' },
		{ type: 'draw_cards', value: 1, target: 'self' },
	],
	tags: ['utility'],
});

/** Move to any empty slot in your formation. */
export const bootleggerTurn = (): Card => movementCard({
	name: 'Bootlegger Turn',
	targetType: 'self',
	cost: 2,
	effects: [{ type: 'change_position', position: 'move', to: 'pick', target: 'self' }],
	tags: ['utility'],
});

/** Swerve (you pick the slot), then a Range 1 attack from the new slot. */
export const strafe = (): Card => movementCard({
	name: 'Strafe',
	targetType: 'enemy_single',
	cost: 2,
	effects: [
		{ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' },
		{ type: 'damage', value: 4, range: 1, target: 'target', always_hits: true },
	],
	tags: ['attack', 'ranged'],
});

/** An order: move an escort, ready or spent, to any empty slot in your formation, without spending it. */
export const fallIn = (): Card => movementCard({
	name: 'Fall In',
	targetType: 'escort',
	effects: [{ type: 'change_position', position: 'move', to: 'pick', target: 'target' }],
	tags: ['order'],
});

/** Swap slots with your partner's vehicle or an escort next to you. */
export const leapfrog = (): Card => movementCard({
	name: 'Leapfrog',
	targetType: 'ally',
	effects: [{ type: 'change_position', position: 'swap', target: 'target' }],
	tags: ['utility'],
});

/** A ram at Range 1; on a hit, shove the raider one row ahead or behind, your pick, if it's in its formation. */
export const shoulderCheck = (): Card => movementCard({
	name: 'Shoulder Check',
	targetType: 'enemy_single',
	cost: 2,
	effects: [
		{ type: 'damage', value: 3, range: 1, attack_type: 'ramming', target: 'target' },
		{ type: 'change_position', position: 'swerve', to: 'pick_row', target: 'target', on_hit: true, optional: true },
	],
	tags: ['attack', 'physical'],
});

/** Swerve one row ahead, then a raider at Range 1 of the new slot is 2 slower (Cut Off, trimmed to what range needs). */
export const cutOff = (): Card => movementCard({
	name: 'Cut Off',
	targetType: 'enemy_single',
	cost: 2,
	effects: [
		{ type: 'change_position', position: 'swerve', to: 'ahead', target: 'self' },
		{ type: 'apply_status', status: 'speed_reduction', value: -2, duration: 1, range: 1, target: 'target', always_hits: true },
	],
	tags: ['utility'],
});
