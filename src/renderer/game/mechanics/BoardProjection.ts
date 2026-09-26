import type { Battle } from './Battle';
import type { Card } from './Card';
import type { Driver } from './Driver';
import { FlankState, Vehicle, statusSpeedModifier } from './Vehicle';
import { TeamType } from './TeamType';
import { RoadSlot, describeSlot, flankLane, isFormationLane, isShoulder, nearestTo, sameSlot, slotRange } from './Road';
import { EffectRecipient, effectRecipientOf, effectRecipients, rollsToHit } from './EffectTargets';
import { ESCORT_CONFIGS } from './Escort';

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
	return card.effects.some(effect => effect.type === 'change_position' && effect.position === 'flanking');
}

/**
 * Speed a card's own statuses give whoever acts, applied before its flank
 * (Run Ahead's boost)
 */
function selfSpeedBonus(card: Card): number {
	return card.effects
		.filter(effect => (effect.type === 'apply_status' || effect.type === 'status') && effect.status &&
			effectRecipientOf({ effect, card }) === EffectRecipient.CASTER)
		.reduce((sum, effect) => sum + statusSpeedModifier({ name: effect.status ?? '', duration: 1, value: effect.value }), 0);
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
	speed: number;
}

/**
 * A scratch copy of what a turn's plan can change on the road: every
 * vehicle's slot, flank state, and speed, plus each driver's hand and
 * adrenaline as bookkeeping. Planning applies each chosen card here so later
 * picks see the board after a flank or a Nitro Boost; the Battle is never
 * touched. Damage isn't projected. Draws aren't either: nobody knows the
 * card until it's drawn, so a card drawn mid-turn is never planned, and a
 * projected hand only shrinks and can't pass HAND_CAP. A fresh projection is
 * the live board.
 */
export class BoardProjection {
	private readonly battle: Battle;
	private readonly vehicles = new Map<Vehicle, ProjectedVehicle>();
	private readonly hands = new Map<Driver, Card[]>();
	private readonly adrenaline = new Map<Driver, number>();
	/** When set, only this vehicle's driver acts. Planning runs one raider at a time. */
	public actor: Vehicle | null = null;

	constructor({ battle }: { battle: Battle }) {
		this.battle = battle;
		for (const team of [battle.playerTeam, battle.enemyTeam]) {
			for (const vehicle of team.vehicles) {
				this.vehicles.set(vehicle, {
					team: team.type,
					slot: vehicle.slot,
					flank: vehicle.flank,
					speed: vehicle.speed
				});
				for (const driver of [vehicle.driver, vehicle.passenger]) {
					if (!driver) continue;
					this.hands.set(driver, [...driver.hand]);
					this.adrenaline.set(driver, driver.adrenaline);
				}
			}
		}
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
		return this.vehicles.get(vehicle)?.speed ?? 0;
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
	 * Why a vehicle can't flank a target, or null if it can. The target is
	 * the vehicle to outrun: it must be in the other team's formation and
	 * slower than the flanker, and the shoulder slot in its row must be free.
	 * A speed bonus counts a boost the flanking card gives first.
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
		if (!target.isAlive() || !targetState.slot || !isFormationLane(targetState.team, targetState.slot.lane)) {
			return `${target.name} is not in formation`;
		}
		if (flankerState.speed + speedBonus <= targetState.speed) {
			return `${flanker.name} is not faster than ${target.name}`;
		}
		const destination = this.flankDestination(flanker, target);
		if (this.isSlotTaken(destination, flanker)) {
			return `${describeSlot(destination)} is taken`;
		}
		if (sameSlot(flankerState.slot, destination)) {
			return `${flanker.name} is already flanking in that row`;
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
	public targetBlocker({ card, caster, target }: { card: Card; caster: Vehicle; target: Vehicle }): string | null {
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
		if (card.isOrder) {
			return this.orderTargetBlocker({ card, casterTeam: casterState.team, target, targetTeam: targetState.team });
		}

		const maxRange = cardRange(card);
		if (maxRange !== null) {
			const range = this.range(caster, target);
			if (range > maxRange) {
				return `Target out of range: ${range} > ${maxRange}`;
			}
		}

		if (cardFlanks(card)) {
			const flankBlocker = this.flankBlocker(caster, target);
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

		if (card.targetType === 'enemy_single' && targetState.team === casterState.team) {
			return `${target.name} is not an enemy`;
		}
		if (card.targetType === 'ally' && targetState.team !== casterState.team) {
			return `${target.name} is not an ally`;
		}
		return null;
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
		for (const [vehicle, state] of this.vehicles) {
			if (vehicle === ignoring) continue;
			if (sameSlot(state.slot, slot) || sameSlot(state.flank?.reservedSlot ?? null, slot)) return true;
		}
		return false;
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
	 * a status that would miss doesn't land here either.
	 */
	public apply({ card, driver, target }: { card: Card; driver: Driver; target: Vehicle | null }): void {
		const hand = this.hands.get(driver);
		const index = hand ? hand.indexOf(card) : -1;
		if (!hand || index === -1) {
			throw new Error(`${card.name} is not in the projected hand`);
		}
		hand.splice(index, 1);
		this.adrenaline.set(driver, this.adrenalineOf(driver) - card.cost);

		const caster = this.vehicleOf(driver);
		for (const effect of card.effects) {
			switch (effect.type) {
				case 'change_position': {
					if (effect.position !== 'flanking') break;
					// A failed flank cancels the rest of the card, as it does in the battle
					if (!caster || !target || !this.canFlank(caster, target)) return;
					const casterState = this.vehicles.get(caster);
					if (!casterState?.slot) return;
					casterState.flank = {
						reservedSlot: casterState.flank ? casterState.flank.reservedSlot : casterState.slot,
						outran: target
					};
					casterState.slot = this.flankDestination(caster, target);
					break;
				}
				case 'apply_status':
				case 'status': {
					const status = effect.status;
					if (!status) break;
					const enemies = caster ? this.enemiesOf(caster) : [];
					const onCaster = effectRecipientOf({ effect, card }) === EffectRecipient.CASTER;
					const rolls = rollsToHit({ effect, card });
					for (const recipient of effectRecipients({ effect, card, caster, target, enemies })) {
						if (!onCaster && recipient.isOutOfFight) continue;
						if (effect.condition === 'target_flanking' && !this.isFlanking(recipient)) continue;
						if (rolls && !this.battle.checkHit({ attacker: caster, caster: driver, defender: recipient })) continue;
						const state = this.vehicles.get(recipient);
						if (state) {
							const modifier = statusSpeedModifier({ name: status, duration: 1, value: effect.value });
							state.speed = Math.max(0, state.speed + modifier);
						}
					}
					break;
				}
				case 'gain_resource':
				case 'adrenaline':
					if (effect.type === 'gain_resource' && effect.resource !== 'adrenaline') break;
					this.adrenaline.set(driver, Math.min(driver.maxAdrenaline, this.adrenalineOf(driver) + (effect.value ?? 0)));
					break;
			}
		}
	}
}
