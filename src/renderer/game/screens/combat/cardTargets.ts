import type { Battle } from '../../mechanics/Battle';
import { BoardProjection } from '../../mechanics/BoardProjection';
import type { Card } from '../../mechanics/Card';
import type { Driver } from '../../mechanics/Driver';
import { movesOf } from '../../mechanics/Movement';
import { RoadSlot, sameSlot } from '../../mechanics/Road';
import type { Vehicle } from '../../mechanics/Vehicle';
import { AimStep, aimStepsOf } from './CombatModel';

/**
 * What a card in the hand would offer if it were picked now: its first
 * step's targets, vehicles or slots, and whether the player picks one of
 * them. A card that takes no pick lists what it acts on (the caster's
 * vehicle, every raider, both drivers' vehicles) and `picks` is false.
 * The card acts from `sourceId`, the playing driver's vehicle, except an
 * attack order, which its escort carries out on each raider (`carrierIds`).
 * A card that moves vehicles lists where each would go (`moves`).
 */
export interface CardTargets {
	vehicleIds: readonly string[];
	slots: readonly RoadSlot[];
	picks: boolean;
	sourceId: string | null;
	carrierIds: ReadonlyMap<string, string>;
	moves: readonly CardMove[];
}

/**
 * A vehicle a card would move, and the slot it would move to. `choice` when
 * the card can play out more than one way (a target or a slot to pick), so
 * this move happens only if the player picks it.
 */
export interface CardMove {
	vehicleId: string;
	to: RoadSlot;
	choice: boolean;
}

/** On the road and still in the fight: a wreck or an empty vehicle left for the turn is never a target. */
function inFight(vehicles: readonly Vehicle[]): Vehicle[] {
	return vehicles.filter(vehicle => !vehicle.isOutOfFight);
}

/**
 * The vehicles a driver's card can land on now, and only those (Battle
 * Screen Design section 6): the card's side of the road by its target
 * type, then the battle's own target rule, the one playCard checks (range,
 * flanking, nobody aboard, an order's carrier, a swap's partner or
 * neighbouring escort). Range for a card that moves first is judged from
 * `destination`, the slot an earlier step chose or one it's offering
 * (Strafe). Pass one `board` when asking about several cards or slots.
 */
export function targetableVehicleIds({ battle, driver, card, destination = null, board = new BoardProjection({ battle }) }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	destination?: RoadSlot | null;
	board?: BoardProjection;
}): string[] {
	const players = inFight(battle.playerTeam.vehicles);
	const enemies = inFight(battle.enemyTeam.vehicles);

	let candidates: Vehicle[];
	if (card.isOrder) {
		// An order's targets depend on the convoy, so its rule picks the side
		candidates = [...players, ...enemies];
	} else {
		switch (card.targetType) {
			case 'enemy_single':
				candidates = enemies;
				break;
			case 'self':
				// Only the vehicle the playing driver is in, driving or riding
				candidates = players.filter(vehicle => vehicle.carries(driver));
				break;
			case 'ally':
				candidates = players;
				break;
			case 'any':
				candidates = [...players, ...enemies];
				break;
			default:
				candidates = [];
		}
	}
	return candidates
		.filter(target => battle.getTargetBlocker({ driver, card, target, destination, board }) === null)
		.map(vehicle => vehicle.id);
}

/**
 * The slots a card's slot step offers: where the battle says its move can
 * go, and when a vehicle step follows (Strafe) only the slots from which
 * some vehicle would then pass the target rule, since a slot too far for
 * the card is one it can't use. `target` is the vehicle an earlier step
 * chose, for a move that moves the target.
 */
export function aimSlots({ battle, driver, card, target = null, vehicleStepNext, board = new BoardProjection({ battle }) }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	target?: Vehicle | null;
	vehicleStepNext: boolean;
	board?: BoardProjection;
}): RoadSlot[] {
	const destinations = battle.moveDestinations({ driver, card, target, board });
	if (!vehicleStepNext) return destinations;
	return destinations.filter(slot => targetableVehicleIds({ battle, driver, card, destination: slot, board }).length > 0);
}

/**
 * The vehicles a card that takes no pick acts on: the playing driver's
 * vehicle for a card on themselves, every raider for one on all of them,
 * the vehicles carrying either of your drivers for one on both.
 */
export function actsOnVehicleIds({ battle, driver, card }: { battle: Battle; driver: Driver; card: Card }): string[] {
	switch (card.targetType) {
		case 'enemy_all':
			return inFight(battle.enemyTeam.vehicles).map(vehicle => vehicle.id);
		case 'both_drivers': {
			const drivers = battle.playerTeam.getAliveDrivers();
			return inFight(battle.playerTeam.vehicles)
				.filter(vehicle => drivers.some(each => vehicle.carries(each)))
				.map(vehicle => vehicle.id);
		}
		default:
			return inFight(battle.playerTeam.vehicles).filter(vehicle => vehicle.carries(driver)).map(vehicle => vehicle.id);
	}
}

/**
 * The first pick a card would wait for if chosen now, as the aim's steps
 * run it (`aimStepsOf`): a slot step the battle says isn't needed (an
 * optional move with nowhere to go, call 293) is skipped. Empty targets
 * with `picks` set mean the card has nothing it could pick, so it can't
 * be played now. For a card that moves vehicles, where each would go
 * (`cardMoves`).
 */
export function cardTargets({ battle, driver, card, board = new BoardProjection({ battle }) }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	board?: BoardProjection;
}): CardTargets {
	const steps = aimStepsOf(card);
	let step = 0;
	while (steps[step] === 'slot' && !battle.needsDestination({ driver, card, board })) step++;
	const sourceId = battle.getVehicleForDriver(driver)?.id ?? null;
	let targets: Omit<CardTargets, 'moves'>;
	switch (steps[step]) {
		case 'vehicle': {
			const vehicleIds = targetableVehicleIds({ battle, driver, card, board });
			targets = { vehicleIds, slots: [], picks: true, sourceId, carrierIds: carriersOf({ battle, card, vehicleIds, board }) };
			break;
		}
		case 'slot': {
			const slots = aimSlots({ battle, driver, card, vehicleStepNext: steps.slice(step + 1).includes('vehicle'), board });
			targets = { vehicleIds: [], slots, picks: true, sourceId, carrierIds: new Map() };
			break;
		}
		default:
			targets = { vehicleIds: actsOnVehicleIds({ battle, driver, card }), slots: [], picks: false, sourceId, carrierIds: new Map() };
	}
	return { ...targets, moves: cardMoves({ battle, driver, card, targets, laterSteps: steps.slice(step + 1) }) };
}

/** One way a card could be played: the vehicle and the slot picked for it, where it picks them. */
interface Play {
	target: Vehicle | null;
	destination: RoadSlot | null;
}

/**
 * Every vehicle a card would move, and where to, over each way the player
 * could play it: each slot a first slot step offers (Juke, Strafe), each
 * vehicle a vehicle step offers (Lay on the Horn's raider, Leapfrog's
 * partner) and then each slot a slot step after it offers for that
 * vehicle (Fall In, Shoulder Check), or the one way a card with no pick
 * plays (Lane Change, Formation Shift). Each play runs on its own
 * projection (`BoardProjection.apply`, the battle's own move rules, hit
 * checks and on-hit shoves included), and the vehicles whose slot it
 * changes are its moves. Every move is a `choice` unless the card can
 * play only one way. Empty for a card that moves nobody.
 */
function cardMoves({ battle, driver, card, targets, laterSteps }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	targets: Omit<CardTargets, 'moves'>;
	laterSteps: readonly AimStep[];
}): CardMove[] {
	if (movesOf(card).length === 0) return [];
	const vehicles = [...battle.playerTeam.vehicles, ...battle.enemyTeam.vehicles];
	const byId = (id: string): Vehicle | null => vehicles.find(vehicle => vehicle.id === id) ?? null;

	const plays: Play[] = [];
	if (targets.slots.length > 0) {
		for (const destination of targets.slots) plays.push({ target: null, destination });
	} else if (targets.picks) {
		for (const id of targets.vehicleIds) {
			const target = byId(id);
			const destinations = laterSteps.includes('slot') && battle.needsDestination({ driver, card, target })
				? battle.moveDestinations({ driver, card, target })
				: [null];
			for (const destination of destinations) plays.push({ target, destination });
		}
	} else {
		plays.push({ target: null, destination: null });
	}

	const choice = plays.length > 1;
	const moves: CardMove[] = [];
	for (const { target, destination } of plays) {
		const board = new BoardProjection({ battle });
		const carrierId = target ? targets.carrierIds.get(target.id) : undefined;
		const actor = carrierId ? byId(carrierId) ?? undefined : undefined;
		board.apply({ card, driver, target, destination, actor });
		for (const vehicle of vehicles) {
			const to = board.slotOf(vehicle);
			if (!to || sameSlot(to, vehicle.slot)) continue;
			if (moves.some(move => move.vehicleId === vehicle.id && sameSlot(move.to, to))) continue;
			moves.push({ vehicleId: vehicle.id, to, choice });
		}
	}
	return moves;
}

/** For an attack order, the escort that would carry it out on each of `vehicleIds`; empty for any other card. */
function carriersOf({ battle, card, vehicleIds, board }: { battle: Battle; card: Card; vehicleIds: readonly string[]; board: BoardProjection }): Map<string, string> {
	const carriers = new Map<string, string>();
	if (!battle.isAttackOrder(card)) return carriers;
	for (const target of battle.enemyTeam.vehicles) {
		if (!vehicleIds.includes(target.id)) continue;
		const carrier = board.orderCarrier({ card, target });
		if (carrier) carriers.set(target.id, carrier.id);
	}
	return carriers;
}

/** Whether a card has anything to land on now: anything it acts on, or something to pick. */
export function hasTargets(targets: CardTargets): boolean {
	return !targets.picks || targets.vehicleIds.length > 0 || targets.slots.length > 0;
}
