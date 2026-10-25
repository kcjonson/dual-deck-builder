import type { Battle } from '../../mechanics/Battle';
import { previewAim } from '../../mechanics/AimPreview';
import { BoardProjection, cardRange } from '../../mechanics/BoardProjection';
import type { Card, CardEffect } from '../../mechanics/Card';
import type { Driver } from '../../mechanics/Driver';
import { EffectRecipient, effectRecipientOf } from '../../mechanics/EffectTargets';
import { movesOf } from '../../mechanics/Movement';
import { RoadSlot, sameSlot } from '../../mechanics/Road';
import type { Vehicle } from '../../mechanics/Vehicle';
import { AimStep, aimStepsOf } from './CombatModel';

/** One arrow of a card's preview: the vehicle that acts, and the vehicle it acts on. */
export interface TargetLink {
	sourceId: string;
	targetId: string;
}

/**
 * A vehicle a card would move, and the slot it would move to. `choice` when
 * the move happens only for some of the ways the card can be played (a
 * target or a slot the player picks), so only if the player picks it.
 */
export interface CardMove {
	vehicleId: string;
	to: RoadSlot;
	choice: boolean;
}

/**
 * What a card in the hand would offer if it were picked now: its first
 * step's targets, vehicles or slots, and whether the player picks one of
 * them. A card that takes no pick lists what it acts on (the caster's
 * vehicle, every raider, both drivers' vehicles) and `picks` is false.
 * `links` are who acts on whom, one arrow each: from the playing driver's
 * vehicle, or the escort carrying out an order, and never from a vehicle
 * to itself. A card that moves vehicles lists where each would go
 * (`moves`).
 */
export interface CardTargets {
	vehicleIds: readonly string[];
	slots: readonly RoadSlot[];
	picks: boolean;
	links: readonly TargetLink[];
	moves: readonly CardMove[];
}

/** On the road and still in the fight: a wreck or an empty vehicle left for the turn is never a target. */
function inFight(vehicles: readonly Vehicle[]): Vehicle[] {
	return vehicles.filter(vehicle => !vehicle.isOutOfFight);
}

/** The vehicles on a card's side of the road by its target type, before the battle's target rule. */
function candidatesFor({ battle, driver, card }: { battle: Battle; driver: Driver; card: Card }): Vehicle[] {
	const players = inFight(battle.playerTeam.vehicles);
	const enemies = inFight(battle.enemyTeam.vehicles);
	// An order's targets depend on the convoy, so its rule picks the side
	if (card.isOrder) return [...players, ...enemies];
	switch (card.targetType) {
		case 'enemy_single':
			return enemies;
		case 'self':
			// Only the vehicle the playing driver is in, driving or riding
			return players.filter(vehicle => vehicle.carries(driver));
		case 'ally':
			return players;
		case 'any':
			return [...players, ...enemies];
		default:
			return [];
	}
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
	return candidatesFor({ battle, driver, card })
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
 * The aim's steps for a card (`aimStepsOf`) and the one it would wait for
 * first: a slot step the battle says isn't needed (an optional move with
 * nowhere to go, call 293) is skipped.
 */
function firstStep({ battle, driver, card, board }: { battle: Battle; driver: Driver; card: Card; board: BoardProjection }): { steps: AimStep[]; step: number } {
	const steps = aimStepsOf(card);
	let step = 0;
	while (steps[step] === 'slot' && !battle.needsDestination({ driver, card, board })) step++;
	return { steps, step };
}

/**
 * Whether a card the rules allow has anything to land on now: a vehicle
 * its vehicle step could pick, a slot its slot step could pick (and for
 * Strafe, one that puts a target in reach), or no pick to make. The hand
 * asks this of every card on every deal, so it stops at the first target
 * it finds; `cardTargets` lists them all, for the one card being previewed.
 */
export function cardHasTargets({ battle, driver, card, board = new BoardProjection({ battle }) }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	board?: BoardProjection;
}): boolean {
	const { steps, step } = firstStep({ battle, driver, card, board });
	const lands = (destination: RoadSlot | null) => (target: Vehicle) =>
		battle.getTargetBlocker({ driver, card, target, destination, board }) === null;
	switch (steps[step]) {
		case 'vehicle':
			return candidatesFor({ battle, driver, card }).some(lands(null));
		case 'slot': {
			const destinations = battle.moveDestinations({ driver, card, board });
			if (!steps.slice(step + 1).includes('vehicle')) return destinations.length > 0;
			const candidates = candidatesFor({ battle, driver, card });
			return destinations.some(destination => candidates.some(lands(destination)));
		}
		default:
			return true;
	}
}

/** Rally the Convoy's shape: an order on every raider, carried out by each ready escort (Battle.rallyConvoy). */
function ralliesConvoy(card: Card): boolean {
	return card.isOrder && card.targetType === 'enemy_all';
}

/**
 * Who Rally the Convoy would hit: each ready escort on the nearest raider
 * within the card's range, as Battle.rallyConvoy picks them. The battle
 * picks again after each shot, so a raider an earlier escort wrecks isn't
 * shot twice; the preview can't know who a shot wrecks, so it shows each
 * escort's pick on the board as it stands.
 */
function rallyLinks({ battle, card, board }: { battle: Battle; card: Card; board: BoardProjection }): TargetLink[] {
	const range = cardRange(card) ?? 0;
	const links: TargetLink[] = [];
	for (const escort of battle.playerTeam.escorts) {
		if (!escort.isReady) continue;
		const raider = board.nearestEnemyInRange({ from: escort, range });
		if (raider) links.push({ sourceId: escort.id, targetId: raider.id });
	}
	return links;
}

const isStun = (effect: CardEffect): boolean => (effect.type === 'apply_status' || effect.type === 'status') && effect.status === 'stunned';

/**
 * Whether a card that lands on every raider takes hold on this one: a card
 * that only stuns (EMP Blast) does nothing to a Steady raider, as
 * Battle.applyEffect and BoardProjection.applyLanding skip it.
 */
function takesHold(card: Card, vehicle: Vehicle): boolean {
	const landing = card.effects.filter(effect => effectRecipientOf({ effect, card }) !== EffectRecipient.CASTER);
	return !(vehicle.isSteady && landing.length > 0 && landing.every(isStun));
}

/**
 * The vehicles a card that takes no pick acts on: the playing driver's
 * vehicle for a card on themselves, every raider it takes hold on for one
 * on all of them, the vehicles carrying either of your drivers for one on
 * both.
 */
function actsOn({ battle, driver, card }: { battle: Battle; driver: Driver; card: Card }): Vehicle[] {
	switch (card.targetType) {
		case 'enemy_all':
			return inFight(battle.enemyTeam.vehicles).filter(raider => takesHold(card, raider));
		case 'both_drivers': {
			const drivers = battle.playerTeam.getAliveDrivers();
			return inFight(battle.playerTeam.vehicles).filter(vehicle => drivers.some(each => vehicle.carries(each)));
		}
		default:
			return inFight(battle.playerTeam.vehicles).filter(vehicle => vehicle.carries(driver));
	}
}

/**
 * Everything a card would offer if chosen now: the first pick it would
 * wait for, as the aim's steps run it, who acts on whom, and for a card
 * that moves vehicles where each would go (`cardMoves`). Empty targets with
 * `picks` set mean the card has nothing it could pick; `cardHasTargets`
 * answers that alone, without the rest.
 */
export function cardTargets({ battle, driver, card, board = new BoardProjection({ battle }) }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	board?: BoardProjection;
}): CardTargets {
	const { steps, step } = firstStep({ battle, driver, card, board });
	const sourceId = battle.getVehicleForDriver(driver)?.id ?? null;
	const linksFrom = (vehicleIds: readonly string[], carriers: ReadonlyMap<string, string>): TargetLink[] => vehicleIds
		.map(targetId => ({ sourceId: carriers.get(targetId) ?? sourceId, targetId }))
		.filter((link): link is TargetLink => link.sourceId !== null && link.sourceId !== link.targetId);

	let vehicleIds: string[] = [];
	let slots: RoadSlot[] = [];
	let links: TargetLink[] = [];
	let carriers = new Map<string, string>();
	const picks = steps[step] !== undefined;
	switch (steps[step]) {
		case 'vehicle':
			vehicleIds = targetableVehicleIds({ battle, driver, card, board });
			carriers = carriersOf({ battle, card, vehicleIds, board });
			links = linksFrom(vehicleIds, carriers);
			break;
		case 'slot':
			slots = aimSlots({ battle, driver, card, vehicleStepNext: steps.slice(step + 1).includes('vehicle'), board });
			break;
		default:
			if (ralliesConvoy(card)) {
				links = rallyLinks({ battle, card, board });
				vehicleIds = [...new Set(links.map(link => link.targetId))];
			} else {
				vehicleIds = actsOn({ battle, driver, card }).map(vehicle => vehicle.id);
				links = linksFrom(vehicleIds, carriers);
			}
	}
	const moves = cardMoves({ battle, driver, card, board, vehicleIds, slots, picks, carriers, laterSteps: steps.slice(step + 1) });
	return { vehicleIds, slots, picks, links, moves };
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
 * plays (Lane Change, Formation Shift). Each play runs on its own copy of
 * the board (`BoardProjection.apply`, the battle's own move rules, hit
 * checks and on-hit shoves included), and the vehicles whose slot it
 * changes are its moves. A move every play makes is certain; one only
 * some plays make is a `choice`. Empty for a card that moves nobody.
 */
function cardMoves({ battle, driver, card, board, vehicleIds, slots, picks, carriers, laterSteps }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	board: BoardProjection;
	vehicleIds: readonly string[];
	slots: readonly RoadSlot[];
	picks: boolean;
	carriers: ReadonlyMap<string, string>;
	laterSteps: readonly AimStep[];
}): CardMove[] {
	if (movesOf(card).length === 0) return [];
	const vehicles = [...battle.playerTeam.vehicles, ...battle.enemyTeam.vehicles];
	const byId = (id: string): Vehicle | null => vehicles.find(vehicle => vehicle.id === id) ?? null;

	const plays: Play[] = [];
	if (slots.length > 0) {
		for (const destination of slots) plays.push({ target: null, destination });
	} else if (picks) {
		for (const id of vehicleIds) {
			const target = byId(id);
			const destinations = laterSteps.includes('slot') && battle.needsDestination({ driver, card, target, board })
				? battle.moveDestinations({ driver, card, target, board })
				: [null];
			for (const destination of destinations) plays.push({ target, destination });
		}
	} else {
		plays.push({ target: null, destination: null });
	}

	// Each distinct move, and how many plays make it
	const made = new Map<string, { move: CardMove; plays: number }>();
	for (const play of plays) {
		for (const { vehicle, to } of playMoves({ battle, driver, card, board, vehicles, play, carriers })) {
			const key = `${vehicle.id}|${to.lane}|${to.row}`;
			const entry = made.get(key) ?? { move: { vehicleId: vehicle.id, to, choice: false }, plays: 0 };
			entry.plays++;
			made.set(key, entry);
		}
	}
	return [...made.values()].map(({ move, plays: count }) => ({ ...move, choice: count < plays.length }));
}

/**
 * The vehicles one play moves, on a copy of the board. A hit that takes
 * its target out (wrecked, or its driver killed) leaves the wreck where it
 * is, so a move of that target the hit was to cause (Shoulder Check's
 * shove) doesn't happen, as Battle.applyMove refuses it.
 */
function playMoves({ battle, driver, card, board, vehicles, play: { target, destination }, carriers }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	board: BoardProjection;
	vehicles: readonly Vehicle[];
	play: Play;
	carriers: ReadonlyMap<string, string>;
}): { vehicle: Vehicle; to: RoadSlot }[] {
	const projection = board.copy();
	const carrierId = target ? carriers.get(target.id) : undefined;
	const actor = carrierId ? vehicles.find(vehicle => vehicle.id === carrierId) : undefined;
	projection.apply({ card, driver, target, destination, actor });
	const wrecked = target !== null && takesOut({ battle, driver, card, target, destination, board });
	const moves: { vehicle: Vehicle; to: RoadSlot }[] = [];
	for (const vehicle of vehicles) {
		const to = projection.slotOf(vehicle);
		if (!to || sameSlot(to, vehicle.slot) || (wrecked && vehicle === target)) continue;
		moves.push({ vehicle, to });
	}
	return moves;
}

/** Whether the card's hit would take `target` out of the fight: its structure gone, or the driver of a driven vehicle killed. */
function takesOut({ battle, driver, card, target, destination, board }: {
	battle: Battle;
	driver: Driver;
	card: Card;
	target: Vehicle;
	destination: RoadSlot | null;
	board: BoardProjection;
}): boolean {
	const { losses } = previewAim({ battle, driver, card, target, destination, board });
	if (losses.structure > 0 && losses.structure >= target.structure) return true;
	return !target.isEscort && target.driver !== null && losses.driver > 0 && losses.driver >= target.driver.hitpoints;
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
