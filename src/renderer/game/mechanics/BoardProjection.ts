import type { Battle } from './Battle';
import type { Card } from './Card';
import type { Driver } from './Driver';
import { FlankState, Vehicle, statusSpeedModifier } from './Vehicle';
import { TeamType } from './TeamType';
import { RoadSlot, describeSlot, flankLane, isFormationLane, isShoulder, sameSlot, slotRange } from './Road';

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
					speed: vehicle.getTotalSpeed()
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
	 */
	public flankBlocker(flanker: Vehicle, target: Vehicle): string | null {
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
		if (flankerState.speed <= targetState.speed) {
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
	 * Play a card on the projection: it leaves the hand, costs adrenaline,
	 * and moves or changes speed as it would in the battle. Hit checks are
	 * deterministic, so a status that would miss doesn't land here either.
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
					const appliesToSelf = effect.target === 'self' || !target;
					const statusVehicle = appliesToSelf ? caster : target;
					if (!statusVehicle || !effect.status) break;
					if (effect.condition === 'target_flanking' && !this.isFlanking(statusVehicle)) break;
					if (!effect.always_hits && !appliesToSelf && statusVehicle.driver &&
						!this.battle.checkHit(driver, statusVehicle.driver)) {
						break;
					}
					const state = this.vehicles.get(statusVehicle);
					if (state) {
						const modifier = statusSpeedModifier({ name: effect.status, duration: 1, value: effect.value });
						state.speed = Math.max(0, state.speed + modifier);
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
