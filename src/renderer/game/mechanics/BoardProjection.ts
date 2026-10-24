import type { Battle } from './Battle';
import type { Card, CardEffect } from './Card';
import type { Driver } from './Driver';
import { BOXED_IN, FlankState, Vehicle, floorSpeed, statusEvadeModifier, statusSpeedModifier } from './Vehicle';
import { effectValue } from './EffectConditions';
import { TeamType } from './TeamType';
import {
	RoadSlot,
	SwerveDirection,
	adjacentFormationSlots,
	describeSlot,
	flankLane,
	formationSlots,
	isFormationLane,
	isFormationMove,
	isShoulder,
	isSwerveStep,
	nearestTo,
	otherFormationLane,
	sameSlot,
	slotBehind,
	slotRange,
	swerveSlot
} from './Road';
import { EffectRecipient, effectRecipientOf, effectRecipients, isCasterAction, rollsToHit } from './EffectTargets';
import { ESCORT_CONFIGS } from './Escort';
import { MoveSpec, casterMoveOf, moveSpecOf, movesOf, picksSlot } from './Movement';

/**
 * The longest range any of a card's effects reaches, or null when none has one
 */
export function cardRange(card: Card): number | null {
	const ranges = card.effects
		.map(effect => effect.range)
		.filter((range): range is number => typeof range === 'number');
	return ranges.length > 0 ? Math.max(...ranges) : null;
}

/**
 * Whether the card moves whoever acts onto the shoulder (Flank, Run Ahead)
 */
export function cardFlanks(card: Card): boolean {
	return movesOf(card).some(move => move.kind === 'flanking');
}

/**
 * Speed a card's own statuses give whoever acts, applied before its flank
 * (Run Ahead's boost, Nitro Boost)
 */
export function selfSpeedBonus(card: Card): number {
	return card.effects
		.filter(effect => (effect.type === 'apply_status' || effect.type === 'status') && effect.status &&
			effectRecipientOf({ effect, card }) === EffectRecipient.CASTER)
		.reduce((sum, effect) => sum + statusSpeedModifier({ name: effect.status ?? '', duration: 1, value: effect.value }), 0);
}

/**
 * Every effect `condition` card data may use, and who reads it:
 * targetConditionBlocker the target conditions, landingConditionHolds the
 * landing ones, targetBlocker, getPlannedCardBlocker, and Battle.applyStatus
 * Oil Slick's `target_flanking`. A `conditional` wrapper's condition
 * (Coordinated Attack, Ramming Speed, Precision Shot) is listed so the data
 * check knows it, though nothing resolves those wrappers yet. A name not
 * here throws where it's read, and fails the card data check.
 */
export const EFFECT_CONDITIONS: readonly string[] = [
	'target_in_formation',
	'target_flanking_in_row',
	'target_ambusher',
	'driven_vehicles_within',
	'target_flanking',
	'partner_attacked',
	'target_has_status',
	'self_has_status'
];

function assertKnownCondition(condition: string): void {
	if (!EFFECT_CONDITIONS.includes(condition)) {
		throw new Error(`Effect condition "${condition}" is not one the battle knows`);
	}
}

/**
 * Effects that land on one person aboard the target vehicle, the driver or
 * passenger the player picks (Triage, Top Off)
 */
const OCCUPANT_EFFECTS = new Set(['heal_driver', 'grant_adrenaline']);

interface ProjectedVehicle {
	team: TeamType;
	slot: RoadSlot | null;
	flank: FlankState | null;
	/** Vehicle.evadeBoost, plus Evade landed on the projection, for its hit checks */
	evadeBoost: number;
	/** Vehicle.speedSum, floored only when read, as play floors it */
	speedSum: number;
	/** Changed slot this turn (Battle.swervedThisTurn), for Weave */
	swerved: boolean;
	/** Can't flank (Vehicle.isBoxedIn), or a Box In applied to this projection since */
	boxedIn: boolean;
}

/** Where a vehicle ends up after a move: its slot and its flank state (a flanker's reservation) */
export interface Placement {
	vehicle: Vehicle;
	slot: RoadSlot;
	flank: FlankState | null;
}

/** A fixed swerve direction with no slot that way, as the log says it */
const SWERVE_WORDS: Record<SwerveDirection, string> = {
	other_lane: 'in another lane',
	outside: 'further out',
	ahead: 'ahead',
	behind: 'behind'
};

/** A fixed swerve's slot relative to its mover, as the log says a stale one (call 289) */
const PLANNED_SWERVE_WORDS: Record<SwerveDirection, string> = {
	other_lane: 'beside',
	outside: 'outside',
	ahead: 'ahead of',
	behind: 'behind'
};

/**
 * A scratch copy of what a turn's plan can change on the road: every
 * vehicle's slot, flank state, and speed, plus each driver's hand and
 * adrenaline as bookkeeping. Planning applies each chosen card here so later
 * picks see the board after a flank or a Nitro Boost; the Battle is never
 * touched. Damage isn't projected. Draws aren't either: nobody knows the
 * card until it's drawn, so a card drawn mid-turn is never planned, and a
 * projected hand never grows. A fresh projection is the live board.
 */
export class BoardProjection {
	private readonly battle: Battle;
	private readonly vehicles = new Map<Vehicle, ProjectedVehicle>();
	private readonly hands = new Map<Driver, Card[]>();
	private readonly adrenaline = new Map<Driver, number>();
	/** When set, only this vehicle's driver acts. Planning runs one raider at a time. */
	public actor: Vehicle | null = null;

	/** `from`: a projection to copy (copy()), instead of the live board */
	constructor({ battle, from = null }: { battle: Battle; from?: BoardProjection | null }) {
		this.battle = battle;
		if (from) {
			for (const [vehicle, state] of from.vehicles) this.vehicles.set(vehicle, { ...state });
			for (const [driver, hand] of from.hands) this.hands.set(driver, [...hand]);
			for (const [driver, adrenaline] of from.adrenaline) this.adrenaline.set(driver, adrenaline);
			this.actor = from.actor;
			return;
		}
		for (const team of [battle.playerTeam, battle.enemyTeam]) {
			for (const vehicle of team.vehicles) {
				this.vehicles.set(vehicle, {
					team: team.type,
					slot: vehicle.slot,
					flank: vehicle.flank,
					evadeBoost: vehicle.evadeBoost,
					speedSum: vehicle.speedSum,
					swerved: battle.swervedThisTurn(vehicle),
					boxedIn: vehicle.isBoxedIn
				});
				for (const driver of [vehicle.driver, vehicle.passenger]) {
					if (!driver) continue;
					this.hands.set(driver, [...driver.hand]);
					this.adrenaline.set(driver, driver.adrenaline);
				}
			}
		}
	}

	/**
	 * This board as it stands, to try a play on (apply) without touching
	 * this one: the AIs' move estimates compare the two
	 */
	public copy(): BoardProjection {
		return new BoardProjection({ battle: this.battle, from: this });
	}

	public slotOf(vehicle: Vehicle): RoadSlot | null {
		return this.vehicles.get(vehicle)?.slot ?? null;
	}

	public flankOf(vehicle: Vehicle): FlankState | null {
		return this.vehicles.get(vehicle)?.flank ?? null;
	}

	public isFlanking(vehicle: Vehicle): boolean {
		const slot = this.slotOf(vehicle);
		return slot !== null && isShoulder(slot.lane);
	}

	public speedOf(vehicle: Vehicle): number {
		return floorSpeed(this.vehicles.get(vehicle)?.speedSum ?? 0);
	}

	/** Evade the vehicle's statuses add on this board: Vehicle.evadeBoost, plus any Evade landed here since */
	public evadeBoostOf(vehicle: Vehicle): number {
		return this.vehicles.get(vehicle)?.evadeBoost ?? vehicle.evadeBoost;
	}

	public handOf(driver: Driver): readonly Card[] {
		return this.hands.get(driver) ?? driver.hand;
	}

	public adrenalineOf(driver: Driver): number {
		return this.adrenaline.get(driver) ?? driver.adrenaline;
	}

	public vehicleOf(driver: Driver): Vehicle | null {
		for (const vehicle of this.vehicles.keys()) {
			if (vehicle.driver === driver || vehicle.passenger === driver) return vehicle;
		}
		return null;
	}

	/**
	 * Whether the vehicle has changed slot this turn: Battle.swervedThisTurn,
	 * plus any move applied to this projection since (Weave reads it)
	 */
	public swervedThisTurn(vehicle: Vehicle): boolean {
		return this.vehicles.get(vehicle)?.swerved ?? false;
	}

	/** Whether the vehicle can't flank (Box In), on this board */
	public isBoxedIn(vehicle: Vehicle): boolean {
		return this.vehicles.get(vehicle)?.boxedIn ?? false;
	}

	/**
	 * Range between two vehicles: lanes apart plus rows apart on the road.
	 */
	public range(from: Vehicle, to: Vehicle): number {
		const fromSlot = this.slotOf(from);
		const toSlot = this.slotOf(to);
		if (!fromSlot || !toSlot) {
			throw new Error(`Range needs both vehicles on the road (${from.name}, ${to.name})`);
		}
		return slotRange(fromSlot, toSlot);
	}

	/**
	 * Why a vehicle can't flank a target, or null if it can. The flanker
	 * can't already be on the shoulder. The target is the vehicle to outrun:
	 * it must be in the other team's formation and slower than the flanker,
	 * and the shoulder slot in its row must be free. A boxed-in vehicle (Box
	 * In) can't flank at all.
	 * A speed bonus counts a boost the flanking card gives first, unless the
	 * flanker is Heavy.
	 */
	public flankBlocker(flanker: Vehicle, target: Vehicle, speedBonus = 0): string | null {
		const flankerState = this.vehicles.get(flanker);
		const targetState = this.vehicles.get(target);
		if (!flankerState || !targetState || flankerState.team === targetState.team) {
			return `${target.name} is not on the other team`;
		}
		if (!flanker.isAlive() || !flankerState.slot) {
			return `${flanker.name} is not on the road`;
		}
		if (isShoulder(flankerState.slot.lane)) {
			return `${flanker.name} is already flanking`;
		}
		if (flankerState.boxedIn) {
			return `${flanker.name} is boxed in and can't flank`;
		}
		if (!target.isAlive() || !targetState.slot || !isFormationLane(targetState.team, targetState.slot.lane)) {
			return `${target.name} is not in formation`;
		}
		if (floorSpeed(flankerState.speedSum + flanker.speedChange(speedBonus)) <= floorSpeed(targetState.speedSum)) {
			return `${flanker.name} is not faster than ${target.name}`;
		}
		const destination = this.flankDestination(flanker, target);
		if (this.isSlotTaken(destination, flanker)) {
			return `${describeSlot(destination)} is taken`;
		}
		return null;
	}

	/**
	 * Why a card can't be played from one vehicle at a target, or null if it
	 * can. The one set of targeting rules: the battle checks a player's play
	 * against a fresh projection, and the AI checks its picks against the
	 * projection it's planning on, so a raider's earlier planned flank counts.
	 * Only for cards that take a target.
	 */
	public targetBlocker({
		card,
		caster,
		target,
		destination = null
	}: {
		card: Card;
		caster: Vehicle;
		target: Vehicle;
		/** The slot picked for the card's move, if it picks one and it's been picked */
		destination?: RoadSlot | null;
	}): string | null {
		const casterState = this.vehicles.get(caster);
		const targetState = this.vehicles.get(target);
		if (!target.isAlive() || !targetState?.slot) {
			return `${target.name} is wrecked`;
		}
		if (target.isUnmanned()) {
			return `${target.name} has nobody aboard`;
		}
		if (card.hitsDriverOnly && !target.driverOnlyTarget) {
			return `${target.name} has nobody aboard to hit`;
		}
		if (!casterState?.slot) {
			return `${caster.name} is not on the road`;
		}
		const needsOccupant = card.effects.some(effect => OCCUPANT_EFFECTS.has(effect.type) &&
			effectRecipientOf({ effect, card }) === EffectRecipient.TARGET);
		if (needsOccupant && ![target.driver, target.passenger].some(occupant => occupant?.isAlive())) {
			return `${target.name} has nobody aboard`;
		}
		const moveBlocker = this.moveBlocker({ card, caster, target, destination });
		if (moveBlocker) {
			return moveBlocker;
		}
		if (card.isOrder) {
			return this.orderTargetBlocker({ card, casterTeam: casterState.team, target, targetTeam: targetState.team });
		}

		const maxRange = cardRange(card);
		if (maxRange !== null) {
			// From where the card's own move lands (Strafe, Cut Off): the nearest
			// of the slots it could pick, until one is picked
			const targetSlot = targetState.slot;
			const range = Math.min(...this.landingSlots({ card, caster, destination }).map(slot => slotRange(slot, targetSlot)));
			if (range > maxRange) {
				return `Target out of range: ${range} > ${maxRange}`;
			}
		}

		if (cardFlanks(card)) {
			// Counting the card's own boost, which lands first (Overtake)
			const flankBlocker = this.flankBlocker(caster, target, selfSpeedBonus(card));
			if (flankBlocker) {
				return `Cannot flank: ${flankBlocker}`;
			}
		}

		for (const effect of card.effects) {
			if (effect.condition === 'target_flanking' && !this.isFlanking(target)) {
				return 'Target must be flanking';
			}
			if (effect.type === 'heal_driver' && effect.target === 'same_vehicle' && caster !== target) {
				return 'Can only heal drivers in same vehicle';
			}
		}
		const conditionBlocker = this.targetConditionBlocker({ card, caster, target });
		if (conditionBlocker) {
			return conditionBlocker;
		}

		if (card.targetType === 'enemy_single' && targetState.team === casterState.team) {
			return `${target.name} is not an enemy`;
		}
		if (card.targetType === 'ally' && targetState.team !== casterState.team) {
			return `${target.name} is not an ally`;
		}
		return null;
	}

	/**
	 * Why the target fails a condition one of the card's effects puts on it,
	 * or null: in its own formation (Lay on the Horn, which never shoves a
	 * flanker or an ambusher), or flanking in the caster's row (Brake
	 * Check). Targeting and a raider's planned card both ask it. Oil Slick's
	 * `target_flanking` is checked beside it, as before. Throws on a
	 * condition no one knows (EFFECT_CONDITIONS).
	 */
	public targetConditionBlocker({ card, caster, target }: { card: Card; caster: Vehicle; target: Vehicle }): string | null {
		const targetState = this.vehicles.get(target);
		const targetSlot = targetState?.slot ?? null;
		for (const effect of card.effects) {
			if (effect.condition === undefined) continue;
			switch (effect.condition) {
				case 'target_in_formation':
					if (!targetState || !targetSlot || !isFormationLane(targetState.team, targetSlot.lane)) {
						return `${target.name} is not in its formation`;
					}
					break;
				case 'target_flanking_in_row':
					if (!this.isFlanking(target)) {
						return `${target.name} is not flanking`;
					}
					if (targetSlot?.row !== this.slotOf(caster)?.row) {
						return `${target.name} is not in ${caster.name}'s row`;
					}
					break;
				default:
					assertKnownCondition(effect.condition);
			}
		}
		return null;
	}

	/**
	 * Whether an effect's landing condition holds for this recipient on this
	 * board, judged as the effect lands: an ambusher for Brake Check's damage
	 * (a flanker with a reserved slot dropped back instead), and every one of
	 * the caster's driven vehicles within reach for Box In's Vulnerable. Play
	 * asks it of a fresh projection, the live board; the projection asks its
	 * own. Any other known condition is checked where it was before, and an
	 * unknown one throws (EFFECT_CONDITIONS).
	 */
	public landingConditionHolds({ effect, caster, recipient }: { effect: CardEffect; caster: Vehicle | null; recipient: Vehicle }): boolean {
		if (effect.condition === undefined) return true;
		switch (effect.condition) {
			case 'target_ambusher':
				return this.isFlanking(recipient) && this.flankOf(recipient)?.reservedSlot === null;
			case 'driven_vehicles_within': {
				if (typeof effect.within !== 'number') throw new Error('driven_vehicles_within needs a number "within"');
				return caster !== null && this.drivenVehiclesWithin({ caster, target: recipient, range: effect.within });
			}
			default:
				assertKnownCondition(effect.condition);
				return true;
		}
	}

	/**
	 * Whether both driven vehicles on the caster's side are within range of
	 * the target (Box In): there have to be two, so once one is wrecked or
	 * carries on as an escort, this never holds (call 321).
	 */
	private drivenVehiclesWithin({ caster, target, range }: { caster: Vehicle; target: Vehicle; range: number }): boolean {
		const side = this.vehicles.get(caster)?.team;
		const targetSlot = this.slotOf(target);
		if (side === undefined || !targetSlot) return false;
		const driven = [...this.vehicles]
			.filter(([vehicle, state]) => state.team === side && state.slot !== null && !vehicle.isEscort && !vehicle.isOutOfFight)
			.map(([, state]) => state.slot as RoadSlot);
		return driven.length >= 2 && driven.every(slot => slotRange(slot, targetSlot) <= range);
	}

	/**
	 * An order is carried out by an escort, not the caster, so range and
	 * flank rules are the carrier's. An attack order's raider needs an escort
	 * to carry it out; a buff order targets an escort in the caster's convoy,
	 * spent or not.
	 */
	private orderTargetBlocker({
		card,
		casterTeam,
		target,
		targetTeam
	}: {
		card: Card;
		casterTeam: TeamType;
		target: Vehicle;
		targetTeam: TeamType;
	}): string | null {
		switch (card.targetType) {
			case 'enemy_single':
				if (targetTeam === casterTeam) {
					return `${target.name} is not an enemy`;
				}
				if (!this.orderCarrier({ card, target })) {
					const who = card.signatureOf ? `ready ${ESCORT_CONFIGS[card.signatureOf].name}` : 'ready escort';
					return `No ${who} can carry out ${card.name} on ${target.name}`;
				}
				return null;
			case 'escort':
				if (targetTeam !== casterTeam || !target.isEscort) {
					return `${target.name} is not an escort in your convoy`;
				}
				return null;
			case 'ally':
				return targetTeam === casterTeam ? null : `${target.name} is not an ally`;
			default:
				return null;
		}
	}

	/**
	 * The escort that carries out an attack order on this raider: the
	 * nearest ready escort on the other team within the card's range of it,
	 * ties broken inside lane, outside lane, shoulder, then ahead, center,
	 * behind. A signature order goes only to escorts of its type, and one
	 * that flanks (Run Ahead) only to one that could outrun the raider after
	 * the card's own boost. Null when no escort can, which makes the raider an
	 * illegal target. Spent state is read from the live vehicles.
	 */
	public orderCarrier({ card, target }: { card: Card; target: Vehicle }): Vehicle | null {
		const targetState = this.vehicles.get(target);
		if (!targetState?.slot || target.isOutOfFight) return null;

		const maxRange = cardRange(card);
		const flanks = cardFlanks(card);
		const speedBonus = selfSpeedBonus(card);
		const candidates = [...this.vehicles].filter(([escort, state]) =>
			state.team !== targetState.team &&
			escort.isReady &&
			state.slot !== null &&
			(!card.signatureOf || escort.escort?.type === card.signatureOf) &&
			(maxRange === null || this.range(escort, target) <= maxRange) &&
			(!flanks || this.flankBlocker(escort, target, speedBonus) === null)
		).map(([escort]) => escort);

		return nearestTo({ to: targetState.slot, candidates, slotOf: escort => this.slotOf(escort) });
	}

	/**
	 * The nearest vehicle on the other team still in the fight within range
	 * of this one, ties broken the same way as orderCarrier (Rally the
	 * Convoy's pick for each escort)
	 */
	public nearestEnemyInRange({ from, range }: { from: Vehicle; range: number }): Vehicle | null {
		const fromSlot = this.slotOf(from);
		if (!fromSlot) return null;
		const candidates = this.enemiesOf(from).filter(enemy =>
			!enemy.isOutOfFight && this.slotOf(enemy) !== null && this.range(from, enemy) <= range);
		return nearestTo({ to: fromSlot, candidates, slotOf: enemy => this.slotOf(enemy) });
	}

	public canFlank(flanker: Vehicle, target: Vehicle): boolean {
		return this.flankBlocker(flanker, target) === null;
	}

	/**
	 * Whether the flanker could flank anyone on the other team still in the
	 * fight, with a speed bonus counted first. Flanking is relative: a speed 5
	 * raider outruns a speed 2 Rig but not a speed 8 Bike, so this, not a
	 * fixed speed, is what makes a vehicle fast enough to flank. An unmanned
	 * raider can't be targeted, so it can't be flanked.
	 */
	public canFlankAnyone(flanker: Vehicle, speedBonus = 0): boolean {
		return this.enemiesOf(flanker).some(target =>
			!target.isOutOfFight && this.flankBlocker(flanker, target, speedBonus) === null);
	}

	/**
	 * The far shoulder, in the row of the vehicle being outrun.
	 */
	public flankDestination(flanker: Vehicle, target: Vehicle): RoadSlot {
		const flankerState = this.vehicles.get(flanker);
		const targetSlot = this.slotOf(target);
		if (!flankerState || !targetSlot) {
			throw new Error(`${flanker.name} can't flank ${target.name} off the road`);
		}
		return { lane: flankLane(flankerState.team), row: targetSlot.row };
	}

	/**
	 * A slot is taken by a vehicle in it, wrecks included, or by a flanker
	 * holding it as its reserved formation slot.
	 */
	private isSlotTaken(slot: RoadSlot, ignoring: Vehicle): boolean {
		return this.slotHolder(slot, ignoring) !== null;
	}

	/** Who holds a slot, in it or keeping it reserved, other than `ignoring` */
	private slotHolder(slot: RoadSlot, ignoring: Vehicle): { vehicle: Vehicle; reserved: boolean } | null {
		for (const [vehicle, state] of this.vehicles) {
			if (vehicle === ignoring) continue;
			if (sameSlot(state.slot, slot)) return { vehicle, reserved: false };
			if (sameSlot(state.flank?.reservedSlot ?? null, slot)) return { vehicle, reserved: true };
		}
		return null;
	}

	/**
	 * Why a vehicle can't move to a slot under the swerve rules (Combat Rules,
	 * Swerving), or null if it can: it's on the road and not flanking (a
	 * flanker can't swerve, and shoves never move a flanker or an ambusher),
	 * the slot is in its own formation (never onto, off, or along a shoulder),
	 * and nobody is in it or holds it reserved. With `step`, a swerve, the
	 * slot also has to be adjacent: range 1, so never diagonal.
	 */
	public slotMoveBlocker({ mover, destination, step }: { mover: Vehicle; destination: RoadSlot; step: boolean }): string | null {
		const state = this.vehicles.get(mover);
		if (!state?.slot || mover.isOutOfFight) {
			return `${mover.name} is not on the road`;
		}
		if (isShoulder(state.slot.lane)) {
			return `${mover.name} is flanking and can't swerve`;
		}
		if (!isFormationMove(state.team, state.slot, destination)) {
			return `${describeSlot(destination)} is not in ${mover.name}'s formation`;
		}
		if (sameSlot(state.slot, destination)) {
			return `${mover.name} is already in ${describeSlot(destination)}`;
		}
		if (step && !isSwerveStep(state.team, state.slot, destination)) {
			return `${describeSlot(destination)} is not next to ${mover.name}`;
		}
		const holder = this.slotHolder(destination, mover);
		if (holder) {
			return holder.reserved
				? `${describeSlot(destination)} is reserved for ${holder.vehicle.name}`
				: `${describeSlot(destination)} is taken by ${holder.vehicle.name}`;
		}
		return null;
	}

	/**
	 * The other vehicle on this one's team carrying a living driver: the
	 * partner's vehicle, driven or ridden in (Slipstream, Leapfrog). Null when
	 * there's none, or more than one, as on a raider team, which never gets
	 * the partner cards (call 287).
	 */
	public partnerVehicleOf(vehicle: Vehicle): Vehicle | null {
		const team = this.vehicles.get(vehicle)?.team;
		const others = [...this.vehicles].filter(([other, state]) =>
			other !== vehicle && state.team === team && state.slot !== null && !other.isOutOfFight &&
			[other.driver, other.passenger].some(occupant => occupant?.isAlive())
		).map(([other]) => other);
		return others.length === 1 ? others[0] : null;
	}

	/**
	 * Every slot a swerve, move, or drop-back can put its mover in on this
	 * board, legal ones only: the one slot for a fixed direction, the choices
	 * for a picked one. Empty when it has nowhere to go. A swap, a formation
	 * shift, and a flank have no destination list.
	 */
	public moveDestinations({ move, mover }: { move: MoveSpec; mover: Vehicle }): RoadSlot[] {
		const state = this.vehicles.get(mover);
		const from = state?.slot;
		if (!state || !from || mover.isOutOfFight) return [];
		const legal = (step: boolean) => (slot: RoadSlot | null): slot is RoadSlot =>
			slot !== null && this.slotMoveBlocker({ mover, destination: slot, step }) === null;
		switch (move.kind) {
			case 'swerve': {
				const candidates = move.to === 'pick' ? adjacentFormationSlots(from)
					: move.to === 'pick_row' ? [swerveSlot(from, 'ahead'), swerveSlot(from, 'behind')]
					: [swerveSlot(from, move.to)];
				return candidates.filter(legal(true));
			}
			case 'move': {
				if (move.to === 'pick') return formationSlots(state.team).filter(legal(false));
				const behind = this.slotBehindPartner(mover);
				return legal(false)(behind) ? [behind] : [];
			}
			case 'drop_back': {
				const reserved = state.flank?.reservedSlot ?? null;
				return reserved && isShoulder(from.lane) ? [reserved] : [];
			}
			default:
				return [];
		}
	}

	/** The slot behind the partner's vehicle in its lane, or null if it has no partner in formation or nothing behind it */
	private slotBehindPartner(mover: Vehicle): RoadSlot | null {
		const partner = this.partnerVehicleOf(mover);
		const partnerSlot = partner ? this.slotOf(partner) : null;
		return partnerSlot && !isShoulder(partnerSlot.lane) ? slotBehind(partnerSlot) : null;
	}

	/**
	 * Why a picked destination isn't one this move can take its mover to, or
	 * null if it is: an adjacent slot for a picked swerve, the slot a row
	 * ahead or behind for a picked row, any formation slot for a picked move,
	 * and every slot rule on top.
	 */
	public destinationBlocker({ move, mover, destination }: { move: MoveSpec; mover: Vehicle; destination: RoadSlot }): string | null {
		if (!picksSlot(move)) {
			return 'This move goes where the card says; it takes no picked slot';
		}
		const from = this.slotOf(mover);
		if (move.kind === 'swerve' && move.to === 'pick_row' && from &&
			!sameSlot(destination, swerveSlot(from, 'ahead')) && !sameSlot(destination, swerveSlot(from, 'behind'))) {
			return `${describeSlot(destination)} is not a row ahead of or behind ${mover.name}`;
		}
		return this.slotMoveBlocker({ mover, destination, step: move.kind === 'swerve' });
	}

	/** Why a move with no legal destination has none, in words for the log and the hand */
	private nowhereReason({ move, mover }: { move: MoveSpec; mover: Vehicle }): string {
		const from = this.slotOf(mover);
		if (!from) return `${mover.name} is not on the road`;
		if (move.kind === 'swerve' && move.to !== 'pick' && move.to !== 'pick_row') {
			const slot = swerveSlot(from, move.to);
			if (!slot) return `${mover.name} has no slot ${SWERVE_WORDS[move.to]}`;
			return this.slotMoveBlocker({ mover, destination: slot, step: true }) ?? `${mover.name} has nowhere to swerve`;
		}
		if (move.kind === 'move' && move.to === 'behind_partner') {
			const partner = this.partnerVehicleOf(mover);
			if (!partner) return `${mover.name} has no partner to slip in behind`;
			if (this.isFlanking(partner)) return `${partner.name} is flanking`;
			const behind = this.slotBehindPartner(mover);
			if (!behind) return `There is no slot behind ${partner.name}`;
			return this.slotMoveBlocker({ mover, destination: behind, step: false }) ?? `${mover.name} has nowhere to move`;
		}
		return move.kind === 'move' ? `${mover.name} has no empty slot to move to` : `${mover.name} has nowhere to swerve`;
	}

	/**
	 * Why two vehicles can't swap slots (Leapfrog), or null if they can: both
	 * on the road in their own formation, neither flanking, and the target is
	 * the partner's vehicle or an escort next to the caster.
	 */
	public swapBlocker({ caster, target }: { caster: Vehicle; target: Vehicle }): string | null {
		const casterState = this.vehicles.get(caster);
		const targetState = this.vehicles.get(target);
		if (!casterState?.slot || caster.isOutOfFight) return `${caster.name} is not on the road`;
		if (!targetState?.slot || target.isOutOfFight) return `${target.name} is not on the road`;
		if (target === caster) return `${caster.name} can't swap with itself`;
		if (targetState.team !== casterState.team) return `${target.name} is not in ${caster.name}'s convoy`;
		if (isShoulder(casterState.slot.lane)) return `${caster.name} is flanking and can't swerve`;
		if (isShoulder(targetState.slot.lane)) return `${target.name} is flanking and can't swerve`;
		const partner = this.partnerVehicleOf(caster) === target;
		const escortBeside = target.isEscort && slotRange(casterState.slot, targetState.slot) === 1;
		if (!partner && !escortBeside) return `${target.name} is neither the partner's vehicle nor an escort next to ${caster.name}`;
		return null;
	}

	/**
	 * Every vehicle on the road a card that moves its target could name, by
	 * its target type, before one is picked: an escort on the caster's side
	 * for Fall In, any vehicle on its side for an ally card, any on the other
	 * side for one aimed at an enemy
	 */
	private moveCandidates({ card, caster }: { card: Card; caster: Vehicle }): Vehicle[] {
		const side = this.vehicles.get(caster)?.team;
		return [...this.vehicles].filter(([vehicle, state]) => {
			if (vehicle.isOutOfFight || !state.slot) return false;
			switch (card.targetType) {
				case 'escort': return state.team === side && vehicle.isEscort;
				case 'ally': return state.team === side;
				case 'enemy_single': return state.team !== side;
				default: return true;
			}
		}).map(([vehicle]) => vehicle);
	}

	/**
	 * Why a card's moves can't happen on this board, or null if they can
	 * (Combat Rules, Swerving). A swerve, move, or swap is unplayable while
	 * its caster is flanking; a swerve or move with nowhere legal to go is
	 * unplayable (call 285); a drop-back needs a flanker with a reserved slot.
	 * Optional moves never block: they're skipped when they can't happen.
	 * With no target (the hand's check), a swap or a move of the card's
	 * target blocks only when nobody the card could name could make it:
	 * Leapfrog with nobody to swap with, Fall In with no escort that can
	 * move (call 341). Once the target is known, its own move is judged. A
	 * picked destination, once given, has to be one the move can take. An
	 * order is carried out by an escort, so its caster's own moves aren't
	 * judged here.
	 */
	public moveBlocker({
		card,
		caster,
		target = null,
		destination = null
	}: {
		card: Card;
		caster: Vehicle;
		target?: Vehicle | null;
		destination?: RoadSlot | null;
	}): string | null {
		for (const move of movesOf(card)) {
			const blocker = this.oneMoveBlocker({ card, move, caster, target, destination });
			if (blocker) return blocker;
		}
		return null;
	}

	private oneMoveBlocker({ card, move, caster, target, destination }: {
		card: Card;
		move: MoveSpec;
		caster: Vehicle;
		target: Vehicle | null;
		destination: RoadSlot | null;
	}): string | null {
		if (move.kind === 'flanking' || move.kind === 'formation_shift' || card.isOrder && move.kind === 'swap') {
			return null;
		}
		if (move.kind === 'swap') {
			if (this.isFlanking(caster)) return `${caster.name} is flanking and can't swerve`;
			if (move.optional) return null;
			if (target) return this.swapBlocker({ caster, target });
			const swappable = [...this.vehicles.keys()].some(other => this.swapBlocker({ caster, target: other }) === null);
			return swappable ? null : `${caster.name} has nobody to swap with`;
		}
		if (move.optional) return null;
		if (move.mover === 'target' && !target) {
			const movable = this.moveCandidates({ card, caster }).some(mover => this.moveDestinations({ move, mover }).length > 0);
			return movable ? null : `${card.name} has no ${card.targetType === 'escort' ? 'escort' : 'target'} that can move`;
		}
		const mover = move.mover === 'caster' ? (card.isOrder ? null : caster) : target;
		if (!mover) return null;
		if (move.kind === 'drop_back') {
			const state = this.vehicles.get(mover);
			if (!state?.slot || !isShoulder(state.slot.lane)) return `${mover.name} isn't flanking`;
			return state.flank?.reservedSlot ? null : `${mover.name} has no reserved slot to drop back to`;
		}
		if (this.isFlanking(mover)) return `${mover.name} is flanking and can't swerve`;
		if (destination && picksSlot(move)) return this.destinationBlocker({ move, mover, destination });
		return this.moveDestinations({ move, mover }).length > 0 ? null : this.nowhereReason({ move, mover });
	}

	/**
	 * Why a raider's planned card can't make its moves as planned, or null
	 * if it can. Its own swerve or move named its destination when planned
	 * (call 289): a picked one has to be a slot it could still pick, and a
	 * fixed one (Lane Change, Floor It) has to be where that direction still
	 * goes, so a raider shoved since the plan fizzles rather than swerving
	 * somewhere the player never saw outlined (call 330). Everything else is
	 * moveBlocker's.
	 */
	public plannedMoveBlocker({
		card,
		caster,
		target = null,
		destination = null
	}: {
		card: Card;
		caster: Vehicle;
		target?: Vehicle | null;
		destination?: RoadSlot | null;
	}): string | null {
		const move = card.isOrder ? null : casterMoveOf(card);
		// picksSlot's guard would narrow a fixed move away, so its test is spelled out
		if (move && destination && !move.optional && move.to !== 'pick' && move.to !== 'pick_row') {
			const blocker = this.slotMoveBlocker({ mover: caster, destination, step: move.kind === 'swerve' });
			if (blocker) return blocker;
			const [slot = null] = this.moveDestinations({ move, mover: caster });
			if (!sameSlot(slot, destination)) {
				const where = move.kind === 'swerve'
					? `${PLANNED_SWERVE_WORDS[move.to]} ${caster.name}`
					: `where ${card.name} takes ${caster.name}`;
				return `${describeSlot(destination)} is no longer ${where}`;
			}
		}
		return this.moveBlocker({ card, caster, target, destination });
	}

	/**
	 * Where the caster stands when the card's other effects reach out: where
	 * its own swerve or move lands (Strafe, Cut Off), or where it is. With a
	 * picked move and no slot picked yet, every slot it could pick, so a
	 * target is in reach if any of them reaches it.
	 */
	public landingSlots({ card, caster, destination = null }: { card: Card; caster: Vehicle; destination?: RoadSlot | null }): RoadSlot[] {
		const slot = this.slotOf(caster);
		if (!slot) return [];
		const move = card.isOrder ? null : casterMoveOf(card);
		if (!move) return [slot];
		if (destination && picksSlot(move)) return [destination];
		const destinations = this.moveDestinations({ move, mover: caster });
		return destinations.length > 0 ? destinations : [slot];
	}

	/**
	 * Where a move puts everyone it moves on this board, or why it can't
	 * happen. The one set of move rules: the battle applies the placements
	 * to the live vehicles, and the projection to its own copy. A flank isn't
	 * resolved here (flankBlocker and flankDestination). `caster` is whoever
	 * acts, `target` the card's target, and `destination` the picked slot for
	 * a move that picks one.
	 */
	public resolveMove({
		move,
		caster,
		target,
		destination = null
	}: {
		move: MoveSpec;
		caster: Vehicle | null;
		target: Vehicle | null;
		destination?: RoadSlot | null;
	}): { placements: Placement[] } | { blocker: string } {
		switch (move.kind) {
			case 'flanking':
				throw new Error('A flank resolves through flankBlocker and flankDestination');
			case 'formation_shift':
				return caster ? { placements: this.formationShift(caster) } : { blocker: 'Nobody to shift the formation' };
			case 'swap': {
				if (!caster || !target) return { blocker: 'A swap needs a vehicle to swap with' };
				const blocker = this.swapBlocker({ caster, target });
				const casterSlot = this.slotOf(caster);
				const targetSlot = this.slotOf(target);
				if (blocker || !casterSlot || !targetSlot) return { blocker: blocker ?? 'Both vehicles have to be on the road' };
				return { placements: [{ vehicle: caster, slot: targetSlot, flank: null }, { vehicle: target, slot: casterSlot, flank: null }] };
			}
		}
		const mover = move.mover === 'caster' ? caster : target;
		if (!mover) return { blocker: move.mover === 'caster' ? 'Nobody to move' : 'This move needs a target' };
		if (move.kind !== 'drop_back' && this.isFlanking(mover)) return { blocker: `${mover.name} is flanking and can't swerve` };
		if (picksSlot(move)) {
			if (!destination) return { blocker: `${mover.name} needs a slot picked to move to` };
			const blocker = this.destinationBlocker({ move, mover, destination });
			return blocker ? { blocker } : { placements: [{ vehicle: mover, slot: destination, flank: null }] };
		}
		const [slot] = this.moveDestinations({ move, mover });
		if (!slot) {
			if (move.kind === 'drop_back') {
				return { blocker: this.isFlanking(mover) ? `${mover.name} has no reserved slot to drop back to` : `${mover.name} isn't flanking` };
			}
			return { blocker: this.nowhereReason({ move, mover }) };
		}
		return { placements: [{ vehicle: mover, slot, flank: null }] };
	}

	/**
	 * Formation Shift: every vehicle in the caster's formation, wrecks still
	 * on the road included, goes to the other lane in its row, and each of
	 * its team's flankers keeps the shoulder with its reservation switched
	 * to the other lane. Rows trade lanes whole, so nobody lands on anyone.
	 */
	private formationShift(caster: Vehicle): Placement[] {
		const team = this.vehicles.get(caster)?.team;
		const placements: Placement[] = [];
		for (const [vehicle, state] of this.vehicles) {
			if (state.team !== team || !state.slot) continue;
			const switched = (slot: RoadSlot): RoadSlot => {
				const lane = otherFormationLane(slot.lane);
				if (!lane) throw new Error(`${describeSlot(slot)} has no other formation lane`);
				return { lane, row: slot.row };
			};
			if (isFormationLane(state.team, state.slot.lane)) {
				placements.push({ vehicle, slot: switched(state.slot), flank: state.flank });
			} else if (state.flank?.reservedSlot) {
				placements.push({ vehicle, slot: state.slot, flank: { ...state.flank, reservedSlot: switched(state.flank.reservedSlot) } });
			}
		}
		return placements;
	}

	/**
	 * Whether a flanker drops back at the end of the turn as this board
	 * stands: no faster than the vehicle it outran, with a reserved slot to
	 * go to, and that vehicle still in the fight (Battle.dropBackSlotOf on
	 * the live board).
	 */
	public wouldDropBack(vehicle: Vehicle): boolean {
		const flank = this.flankOf(vehicle);
		const outran = flank?.outran;
		if (!flank?.reservedSlot || !outran || vehicle.isOutOfFight || outran.isOutOfFight || !this.slotOf(outran)) return false;
		return this.speedOf(vehicle) <= this.speedOf(outran);
	}

	/** Put a vehicle in a slot on the projection, as a move does; a change of slot counts as a swerve this turn. */
	private place({ vehicle, slot, flank }: Placement): void {
		const state = this.vehicles.get(vehicle);
		if (!state) return;
		if (!sameSlot(state.slot, slot)) state.swerved = true;
		state.slot = slot;
		state.flank = flank;
	}

	/**
	 * Swerve a flanker back to its reserved slot, as the end-of-turn
	 * drop-back does. The battle decides who drops back.
	 */
	public dropBack(vehicle: Vehicle): void {
		const state = this.vehicles.get(vehicle);
		if (!state?.flank?.reservedSlot) return;
		state.slot = state.flank.reservedSlot;
		state.flank = null;
	}

	/**
	 * Take a vehicle off the road, as clearing a wreck at the end of a turn does
	 */
	public leaveRoad(vehicle: Vehicle): void {
		this.vehicles.delete(vehicle);
	}

	/**
	 * Every vehicle on the other team from this one
	 */
	public enemiesOf(vehicle: Vehicle): Vehicle[] {
		const team = this.vehicles.get(vehicle)?.team;
		return [...this.vehicles].filter(([, state]) => state.team !== team).map(([other]) => other);
	}

	/**
	 * Play a card on the projection: it leaves the hand, costs adrenaline,
	 * and moves or changes speed as it would in the battle, each effect on
	 * the recipients the battle would pick. Hit checks are deterministic, so
	 * a status that would miss doesn't land here either, and an `on_hit`
	 * effect (Shoulder Check's shove) happens only if an earlier effect
	 * landed on someone else, as Battle.applyCardEffects has it.
	 * `destination` is the slot picked for a move that picks one (Juke,
	 * Bootlegger Turn). `actor` is whoever acts, when that isn't the
	 * driver's own vehicle: the escort carrying out an attack order.
	 */
	public apply({
		card,
		driver,
		target,
		destination = null,
		actor
	}: {
		card: Card;
		driver: Driver;
		target: Vehicle | null;
		destination?: RoadSlot | null;
		actor?: Vehicle;
	}): void {
		const hand = this.hands.get(driver);
		const index = hand ? hand.indexOf(card) : -1;
		if (!hand || index === -1) {
			throw new Error(`${card.name} is not in the projected hand`);
		}
		hand.splice(index, 1);
		this.adrenaline.set(driver, this.adrenalineOf(driver) - card.cost);

		const caster = actor ?? this.vehicleOf(driver);
		const enemies = caster ? this.enemiesOf(caster) : [];
		let landed = false;
		for (const effect of card.effects) {
			if (effect.on_hit && !landed) continue;
			switch (effect.type) {
				case 'change_position': {
					// A failed move cancels the rest of the card, as it does in the battle
					if (!this.applyMove({ move: moveSpecOf(effect), caster, target, destination })) return;
					break;
				}
				case 'gain_resource':
				case 'adrenaline':
					if (effect.type === 'gain_resource' && effect.resource !== 'adrenaline') break;
					this.adrenaline.set(driver, Math.min(driver.maxAdrenaline, this.adrenalineOf(driver) + (effect.value ?? 0)));
					break;
				default:
					if (isCasterAction(effect)) break;
					if (this.applyLanding({ card, effect, driver, caster, target, enemies })) landed = true;
			}
		}
	}

	/**
	 * One effect that lands on vehicles, on the projection: a speed status
	 * changes the recipient's speed, Box In's stops it flanking, and nothing
	 * else changes here. True when it took hold on someone other than the
	 * caster, by the checks Battle.applyEffect makes: in range for damage,
	 * past the hit check unless it always hits, a flanker for
	 * target_flanking, never a Steady raider for a stun, and its landing
	 * condition (landingConditionHolds).
	 */
	private applyLanding({ card, effect, driver, caster, target, enemies }: {
		card: Card;
		effect: CardEffect;
		driver: Driver;
		caster: Vehicle | null;
		target: Vehicle | null;
		enemies: readonly Vehicle[];
	}): boolean {
		const onCaster = effectRecipientOf({ effect, card }) === EffectRecipient.CASTER;
		const isStatus = effect.type === 'apply_status' || effect.type === 'status';
		const casterSlot = caster ? this.slotOf(caster) : null;
		let landed = false;
		for (const recipient of effectRecipients({ effect, card, caster, target, enemies })) {
			if (!onCaster && recipient.isOutOfFight) continue;
			if (!this.landingConditionHolds({ effect, caster, recipient })) continue;
			if (isStatus) {
				if (effect.condition === 'target_flanking' && !this.isFlanking(recipient)) continue;
				if (effect.status === 'stunned' && recipient.isSteady) continue;
				if (rollsToHit({ effect, card }) && !this.battle.checkHit({ attacker: caster, caster: driver, defender: recipient, evadeBoost: this.evadeBoostOf(recipient) })) continue;
				const state = this.vehicles.get(recipient);
				if (state && effect.status) {
					const value = effectValue(effect, { casterSlot, targetSlot: state.slot, casterSwerved: caster ? this.swervedThisTurn(caster) : false });
					const status = { name: effect.status, duration: 1, value };
					state.speedSum += recipient.speedChange(statusSpeedModifier(status));
					state.evadeBoost += statusEvadeModifier(status);
					if (effect.status === BOXED_IN) state.boxedIn = true;
				}
			} else if (effect.type === 'damage' && !onCaster) {
				const recipientSlot = this.slotOf(recipient);
				if (typeof effect.range === 'number' && casterSlot && recipientSlot && slotRange(casterSlot, recipientSlot) > effect.range) continue;
				if (rollsToHit({ effect, card }) && !this.battle.checkHit({
					attacker: caster,
					caster: driver,
					defender: recipient,
					attackType: typeof effect.attack_type === 'string' ? effect.attack_type : effect.scaling === 'ramming' ? 'ramming' : 'ranged',
					modifier: typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0,
					evadeBoost: this.evadeBoostOf(recipient)
				})) continue;
			}
			if (!onCaster) landed = true;
		}
		return landed;
	}

	/**
	 * One move on the projection. False when a move that isn't optional
	 * can't happen, which cancels the rest of the card; an optional one that
	 * can't is skipped.
	 */
	private applyMove({ move, caster, target, destination }: {
		move: MoveSpec;
		caster: Vehicle | null;
		target: Vehicle | null;
		destination: RoadSlot | null;
	}): boolean {
		if (move.kind === 'flanking') {
			const casterSlot = caster ? this.slotOf(caster) : null;
			if (!caster || !target || !casterSlot || !this.canFlank(caster, target)) return false;
			this.place({ vehicle: caster, slot: this.flankDestination(caster, target), flank: { reservedSlot: casterSlot, outran: target } });
			return true;
		}
		const resolved = this.resolveMove({ move, caster, target, destination });
		if ('blocker' in resolved) return move.kind !== 'formation_shift' && move.optional;
		resolved.placements.forEach(placement => this.place(placement));
		return true;
	}
}
