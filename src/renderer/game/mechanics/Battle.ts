import { Team, TeamType } from './Team';
import { Driver, DrawResult } from './Driver';
import { Vehicle } from './Vehicle';
import {
	RoadSlot,
	SHOULDER_CAPACITY,
	describeLane,
	describeSlot,
	flankLane,
	isFormationLane,
	isShoulder,
	openingSlots,
	resolveFormationSlot,
	sameSlot,
	slotRange
} from './Road';
import { Card, CardEffect } from './Card';
import type { HitCheck } from './AimPreview';
import { BoardProjection, cardFlanks, cardRange } from './BoardProjection';
import { ESCORT_CONFIGS } from './Escort';
import type { AfterFight, DividendPayout } from './Convoy';
import { EffectRecipient, effectRecipientOf, effectRecipients, isCasterAction, landsOnTarget, rollsToHit } from './EffectTargets';
import {
	Intent,
	IntentTier,
	IntentType,
	PlannedAction,
	attackEffectOf,
	buffLabelOf,
	debuffLabelOf,
	defendAmountOf,
	intentTypeOf
} from './Intent';
import { Model } from '../core/Model';
import { Rng, freshSeed } from '../core/Rng';
import { AIController } from '../ai/AIController';

/**
 * Battle log message types
 */
export type BattleMessageType = 
	| 'battle_start'
	| 'turn_start'
	| 'turn_end'
	| 'card_played'
	| 'damage_dealt'
	| 'heal_applied'
	| 'armor_gained'
	| 'status_applied'
	| 'miss'
	| 'out_of_range'
	| 'fizzle'
	| 'battle_end'
	| 'adrenaline_remaining'
	| 'cards_burned'
	| 'general'
	| 'debug';

/**
 * Battle log message
 */
export interface BattleMessage {
	type: BattleMessageType;
	/** The record: seat tags and before-and-after numbers, for the simulator and tests. */
	message: string;
	/**
	 * The same event as the player reads it in the combat log, when that
	 * differs from the record: names without seat tags, and no stat dumps.
	 */
	line?: string;
	timestamp: number;
	turn: number;
	metadata?: {
		driver?: string;
		card?: string;
		target?: string;
		value?: number;
		[key: string]: string | number | undefined;
	};
}

/**
 * A hit that landed (`hitLanded`): what the attack dealt, before shield and
 * armor took their share, and the vehicle it landed on, which is still on
 * the road when this fires. A miss (`hitMissed`) has no damage.
 */
export interface HitEvent {
	vehicle: Vehicle;
	damage: number | null;
}

/**
 * A vehicle's driver and its living occupants, taken before a hit
 */
interface Crew {
	driver: Driver | null;
	living: Driver[];
}

/**
 * A planned card as the enemy turn will find it: the plan re-derived from
 * where the raider will really start, and where the card is headed
 */
interface ProjectedAction {
	action: PlannedAction;
	target: Vehicle | null;
	/** The target's projected speed when the card plays */
	targetSpeed: number;
}

/**
 * One raider's action as the enemy turn plays it (stepEnemyTurn). `played`
 * is a card that resolved, hit or miss; `fizzled` is one that was spent and
 * did nothing (an illegal target, nobody aboard, or it couldn't be paid
 * for); `dropped` is a raider giving up the rest of its plan, wrecked,
 * driverless, or stunned, with no card. `target` is where the card was
 * headed after wrecks and Draw Fire, or null for one with no target.
 */
export interface EnemyTurnStep {
	raider: Vehicle;
	card: Card | null;
	target: Vehicle | null;
	outcome: 'played' | 'fizzled' | 'dropped';
}

/**
 * The enemy turn still to play: every raider's planned cards in play order,
 * and the raiders that have dropped the rest of theirs
 */
interface EnemyTurnQueue {
	actions: { raider: Vehicle; action: PlannedAction }[];
	dropped: Set<Vehicle>;
}

/**
 * Cards each driver draws at the start of every turn
 */
export const TURN_DRAW = 5;

/**
 * Statuses whose log line shows the speed change
 */
const SPEED_STATUSES = ['speed_boost', 'nitro_boost', 'speed_reduction', 'oil_slick', 'caltrops'];

/**
 * Battle data interface - all properties of a battle
 */
export interface BattleData {
	playerTeam: Team;
	enemyTeam: Team;
	turn: number;
	isPlayerTurn: boolean;
	battleOver: boolean;
	battleWon: boolean;
	maxTurns?: number;
	battleTied?: boolean;
}

/**
 * Battle state for UI consumption (same as BattleData)
 */
export type BattleState = BattleData;

/**
 * Battle interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Battle extends BattleData {}

/**
 * Battle class representing vehicular combat using the Team system
 * Implements the Symbiotic Driver System with individual driver hands and adrenaline pools
 */
export class Battle extends Model<BattleData> {
	// Runtime property list - MUST match BattleData interface
	static properties = new Set<keyof BattleData>([
		'playerTeam',
		'enemyTeam',
		'turn',
		'isPlayerTurn',
		'battleOver',
		'battleWon',
		'maxTurns',
		'battleTied'
	]);

	// AI controller for managing computer players (stored separately due to Model freezing)
	private static aiControllers = new WeakMap<Battle, AIController>();
	
	// Battle message log (stored separately due to Model freezing)
	private static messageLogs = new WeakMap<Battle, BattleMessage[]>();

	// Each raider's committed cards for the coming enemy turn (stored separately due to Model freezing)
	private static enemyPlans = new WeakMap<Battle, Map<Vehicle, PlannedAction[]>>();
	// The enemy turn being played, between endPlayerTurn and the last step
	private static enemyTurns = new WeakMap<Battle, EnemyTurnQueue>();

	// Each team's drivers in the order they were first seated, so a driver's
	// log name (Player1, Enemy2) survives a wreck or a death
	private static driverSeats = new WeakMap<Battle, Map<TeamType, Driver[]>>();

	// The fight's random stream (stored separately due to Model freezing)
	private static fightRngs = new WeakMap<Battle, Rng>();
	// Each driver's deck stream, forked from the fight's the first time their
	// deck shuffles or draws
	private static deckRngs = new WeakMap<Battle, Map<Driver, Rng>>();

	// Escorts under Draw Fire, in the order it was played, until the end of
	// the next enemy turn (stored separately due to Model freezing)
	private static drawFireCovers = new WeakMap<Battle, Vehicle[]>();

	// The convoy's escorts as the fight began, so one wrecked and cleared off
	// the road is still known as lost when it ends
	private static convoyEscorts = new WeakMap<Battle, Vehicle[]>();

	// What the fight did to the convoy, once it has ended
	private static afterFights = new WeakMap<Battle, AfterFight>();

	// Static flag to control console logging
	public static suppressConsoleLog = false;

	/**
	 * Create a new battle. Everything random in the fight draws from `rng`,
	 * so one stream plays the fight out the same way every time: each
	 * driver's deck shuffles (before the opening deal, and whenever it runs
	 * dry) from `deck:<team>:<seat index>` (`deck:player:0`), and each team's
	 * AI from `ai` forked again by the team's type. A fight given no stream
	 * roots its own with freshSeed.
	 */
	constructor({
		playerTeam,
		enemyTeam,
		maxTurns,
		rng = new Rng({ seed: freshSeed() })
	}: {
		playerTeam: Team;
		enemyTeam: Team;
		maxTurns?: number;
		rng?: Rng;
	}) {
		super({
			playerTeam,
			enemyTeam,
			turn: 1,
			isPlayerTurn: true,
			battleOver: false,
			battleWon: false,
			maxTurns,
			battleTied: false
		});

		// Validate team types
		if (playerTeam.type !== TeamType.PLAYER) {
			throw new Error('Player team must have type PLAYER');
		}
		if (enemyTeam.type !== TeamType.ENEMY) {
			throw new Error('Enemy team must have type ENEMY');
		}

		this.placeOpeningFormation();

		Battle.driverSeats.set(this, new Map([
			[TeamType.PLAYER, playerTeam.getAllDrivers()],
			[TeamType.ENEMY, enemyTeam.getAllDrivers()]
		]));
		Battle.convoyEscorts.set(this, playerTeam.convoyEscorts);
		Battle.fightRngs.set(this, rng);
		Battle.deckRngs.set(this, new Map());

		// Initialize AI controller (stored in WeakMap to avoid Model freezing issues)
		Battle.aiControllers.set(this, new AIController({ battle: this, rng: rng.fork('ai') }));
		
		// Initialize message log
		Battle.messageLogs.set(this, []);
	}

	/**
	 * Put every vehicle on the road. A vehicle that arrives with a slot (from
	 * its encounter) keeps it; the rest fill their team's formation in
	 * opening order, so the player's pair starts inside center and inside
	 * behind. Escorts go after the driven vehicles, in roster order, each to
	 * its type's preferred slot, or the next free one in opening order if
	 * that's taken. A slot on the other team's shoulder makes the vehicle an
	 * ambusher. The whole opening is planned and checked before anyone moves,
	 * so an encounter it refuses leaves every vehicle as it came: a convoy's
	 * escorts stay off the road for the next fight.
	 */
	private placeOpeningFormation(): void {
		const { slots, ambushers } = this.planOpeningFormation();
		for (const [vehicle, slot] of slots) {
			vehicle.set({ slot, flank: ambushers.includes(vehicle) ? { reservedSlot: null, outran: null } : null });
		}
	}

	/**
	 * Where every vehicle opens, and which open as ambushers, moving nobody.
	 * Throws on a shoulder over capacity, a preset slot outside the team's
	 * own formation and the other team's shoulder, two vehicles in one slot,
	 * a full formation, or an ambusher getAmbushBlocker refuses, judged on the
	 * planned road, since it needs an opposing vehicle in its row.
	 */
	private planOpeningFormation(): { slots: Map<Vehicle, RoadSlot>; ambushers: Vehicle[] } {
		const teams = [this.playerTeam, this.enemyTeam];
		const slots = new Map<Vehicle, RoadSlot>();
		const isTaken = (slot: RoadSlot): boolean => [...slots.values()].some(planned => sameSlot(planned, slot));
		const ambushers: { vehicle: Vehicle; teamType: TeamType; slot: RoadSlot }[] = [];

		for (const team of teams) {
			const shoulder = flankLane(team.type);
			// Slot collisions catch this too; clearer error
			const onShoulder = team.vehicles.filter(vehicle => vehicle.slot?.lane === shoulder).length;
			if (onShoulder > SHOULDER_CAPACITY) {
				throw new Error(`${onShoulder} vehicles start on the ${describeLane(shoulder)}; a shoulder holds ${SHOULDER_CAPACITY}`);
			}

			for (const vehicle of team.vehicles) {
				const slot = vehicle.slot;
				if (!slot) continue;
				const ambush = slot.lane === shoulder;
				if (!ambush && !isFormationLane(team.type, slot.lane)) {
					throw new Error(`${vehicle.name} must start in its own formation, not ${describeSlot(slot)}`);
				}
				if (isTaken(slot)) {
					throw new Error(`Two vehicles start in ${describeSlot(slot)}`);
				}
				slots.set(vehicle, slot);
				if (ambush) ambushers.push({ vehicle, teamType: team.type, slot });
			}
		}

		for (const team of teams) {
			const freeSlots = openingSlots(team.type).filter(slot => !isTaken(slot));
			const unplaced = team.vehicles.filter(vehicle => !slots.has(vehicle));
			const inPlacementOrder = [
				...unplaced.filter(vehicle => !vehicle.isEscort),
				...unplaced.filter(vehicle => vehicle.isEscort)
			];
			for (const vehicle of inPlacementOrder) {
				const preferred = vehicle.escort ? resolveFormationSlot(team.type, vehicle.escort.preferredSlot) : null;
				const preferredIndex = freeSlots.findIndex(free => sameSlot(free, preferred));
				const [slot] = freeSlots.splice(Math.max(preferredIndex, 0), 1);
				if (!slot) {
					throw new Error(`No formation slot left for ${vehicle.name}; a formation holds six`);
				}
				slots.set(vehicle, slot);
			}
		}

		for (const ambusher of ambushers) {
			// Flanks are all cleared at the opening, so no slot is reserved yet
			const blocker = this.ambushBlocker({ ...ambusher, slotOf: vehicle => slots.get(vehicle) ?? null, reservedSlotOf: () => null });
			if (blocker) {
				throw new Error(blocker);
			}
		}
		return { slots, ambushers: ambushers.map(({ vehicle }) => vehicle) };
	}

	/**
	 * Whether an encounter may start this vehicle on the other team's
	 * shoulder. Raiders can, at the start of a fight or when a reinforcement
	 * wave arrives. On the player's side only set-piece escorts can; the
	 * driven vehicles and the convoy's own escorts always start in formation.
	 */
	private static mayAmbush(vehicle: Vehicle, teamType: TeamType): boolean {
		return teamType === TeamType.ENEMY || Boolean(vehicle.escort?.setPiece);
	}

	/**
	 * Why a vehicle can't enter the fight already flanking in this slot, or
	 * null if it can. The slot must be the other team's shoulder, free (not
	 * held or reserved), and in a row with an in-fight vehicle of the other
	 * team, wherever it is in that row. The row check applies only on
	 * arrival; once there, an ambusher keeps its slot even if the vehicle
	 * beside it is wrecked. Opening placement uses this, and a reinforcement
	 * wave arriving mid-fight should too (no wave code exists yet). A vehicle
	 * already on a team must be checked for that team; one still arriving
	 * goes by the team passed in.
	 */
	public getAmbushBlocker({ vehicle, teamType, slot }: { vehicle: Vehicle; teamType: TeamType; slot: RoadSlot }): string | null {
		return this.ambushBlocker({
			vehicle,
			teamType,
			slot,
			slotOf: other => other.slot,
			reservedSlotOf: other => other.flank?.reservedSlot ?? null
		});
	}

	/** getAmbushBlocker on a road read through `slotOf` and `reservedSlotOf`: the road as it is, or as the opening plans it. */
	private ambushBlocker({ vehicle, teamType, slot, slotOf, reservedSlotOf }: {
		vehicle: Vehicle;
		teamType: TeamType;
		slot: RoadSlot;
		slotOf: (vehicle: Vehicle) => RoadSlot | null;
		reservedSlotOf: (vehicle: Vehicle) => RoadSlot | null;
	}): string | null {
		const currentTeam = this.getTeamForVehicle(vehicle);
		if (currentTeam && currentTeam.type !== teamType) {
			return `${vehicle.name} is on the ${currentTeam.type} team, not the ${teamType} team`;
		}
		if (!Battle.mayAmbush(vehicle, teamType)) {
			return vehicle.isEscort
				? `${vehicle.name} can't start flanking; only set-piece escorts ambush, the convoy's own start in formation`
				: `${vehicle.name} can't start flanking; the player's driven vehicles always start in formation`;
		}
		if (slot.lane !== flankLane(teamType)) {
			return `${vehicle.name} can only ambush from the ${describeLane(flankLane(teamType))}, not ${describeSlot(slot)}`;
		}
		const taken = this.getAllVehicles().some(other => other !== vehicle &&
			(sameSlot(slotOf(other), slot) || sameSlot(reservedSlotOf(other), slot)));
		if (taken) {
			return `${describeSlot(slot)} is taken`;
		}
		const opposingTeam = teamType === TeamType.PLAYER ? this.enemyTeam : this.playerTeam;
		const hasOpponentInRow = opposingTeam.vehicles.some(other => !other.isOutOfFight && slotOf(other)?.row === slot.row);
		if (!hasOpponentInRow) {
			return `${vehicle.name} can't ambush in the ${slot.row} row; no ${opposingTeam.type} vehicle is in it`;
		}
		return null;
	}

	/**
	 * The fight stream's seed, logged when the fight starts: the same teams
	 * and the same plays on `rng: new Rng({ seed })` go the same way, so a
	 * fight that minted its own stream can still be replayed.
	 */
	public get seed(): number {
		const fight = Battle.fightRngs.get(this);
		if (!fight) throw new Error('Battle random streams not initialized');
		return fight.seed;
	}

	/**
	 * The player's drivers in seat order, Driver 1 first: everyone aboard when
	 * the fight was built, in the order their vehicles are listed, then anyone
	 * seated later. A driver keeps their seat through a wreck or a death.
	 */
	public get playerSeats(): readonly Driver[] {
		return [...(Battle.driverSeats.get(this)?.get(TeamType.PLAYER) ?? [])];
	}

	/**
	 * Get the AI controller for this battle
	 */
	public get aiController(): AIController {
		const controller = Battle.aiControllers.get(this);
		if (!controller) {
			throw new Error('AI controller not initialized');
		}
		return controller;
	}

	/**
	 * Log a battle message. `line` is the player's version when the record
	 * carries more than they need (BattleMessage.line). `debug` messages are
	 * for the record only and never reach the combat log.
	 */
	private log(type: BattleMessageType, message: string, metadata?: BattleMessage['metadata'], line?: string): void {
		const messageLog = Battle.messageLogs.get(this);
		if (!messageLog) {
			throw new Error('Message log not initialized');
		}

		const logEntry: BattleMessage = {
			type,
			message,
			timestamp: Date.now(),
			turn: this.turn,
			metadata,
			...(line !== undefined && line !== message ? { line } : {}),
		};

		messageLog.push(logEntry);

		// Emit the message as an event
		this.emit('battleMessage', Object.freeze(logEntry));

		// Also log to console in development (but not during AI evaluation)
		if (process.env.NODE_ENV !== 'test' && !Battle.suppressConsoleLog) {
			console.log(message);
		}
	}

	/**
	 * Log one sentence about a driver, said twice from the same words: the
	 * record names them with their seat and adds `detail` (before-and-after
	 * numbers), the player's line names them plainly.
	 */
	private logAbout({ type, driver, say, detail = '', metadata }: {
		type: BattleMessageType;
		driver: Driver;
		say: (name: string) => string;
		detail?: string;
		metadata?: BattleMessage['metadata'];
	}): void {
		this.log(type, say(this.getDriverDisplayName(driver)) + detail, metadata, say(driver.metadata.name));
	}

	/**
	 * Get all battle messages
	 */
	public getMessages(): readonly BattleMessage[] {
		const messageLog = Battle.messageLogs.get(this);
		if (!messageLog) {
			return [];
		}
		return [...messageLog]; // Return a copy
	}

	/**
	 * Get messages of a specific type
	 */
	public getMessagesByType(type: BattleMessageType): readonly BattleMessage[] {
		return this.getMessages().filter(msg => msg.type === type);
	}

	/**
	 * Clear all battle messages
	 */
	public clearMessages(): void {
		const messageLog = Battle.messageLogs.get(this);
		if (messageLog) {
			messageLog.length = 0;
		}
	}

	/**
	 * Start the battle
	 */
	public start(): void {
		// Set initiative (players always go first)
		this.playerTeam.setInitiative();
		this.enemyTeam.setInitiative();

		this.shuffleOpeningDecks();
		this.drawTurnHands();

		// Refill adrenaline for all drivers
		this.playerTeam.refillAdrenaline();
		this.enemyTeam.refillAdrenaline();

		this.playerTeam.readyEscorts();
		this.clearShields();

		this.planEnemyTurn();

		this.log('battle_start', 'Battle started!');
		this.log('debug', `Fight seed ${this.seed}`);
		
		// Log initial team status
		this.logTeamStatus();
		
		// Emit battle started event
		this.emit('battleStarted', this.getState());
	}

	// Model properties are automatically available as:
	// this.playerTeam, this.enemyTeam, this.turn, this.isPlayerTurn, etc.

	/**
	 * Check if the battle is over
	 */
	public isBattleOver(): boolean {
		return this.battleOver;
	}

	/**
	 * Check if the battle was won by the player
	 */
	public isBattleWon(): boolean {
		return this.battleOver && this.battleWon;
	}

	/**
	 * Check if the battle ended in a tie
	 */
	public isBattleTied(): boolean {
		return this.battleOver && (this.battleTied || false);
	}

	/**
	 * Play a card from a specific driver's hand
	 */
	public playCard({
		driver,
		cardIndex,
		targetVehicle,
		targetOccupant
	}: {
		driver: Driver;
		cardIndex: number;
		targetVehicle?: Vehicle;
		/** For a card that lands on one person aboard (Triage, Top Off, Medical Kit): who. Defaults to the driver, or an escort's passenger. */
		targetOccupant?: Driver;
	}): boolean {
		if (!this.isPlayerTurn) {
			this.log('general', "Cannot play card: not player's turn");
			return false;
		}

		// Check life, cost, passenger rules, and target before the card leaves
		// the hand. A dead driver has left their seat, so this comes before the
		// team check to say why.
		const blocker = driver.getPlayBlocker(cardIndex);
		if (blocker) {
			this.log('general', `Cannot play card: ${blocker}`);
			return false;
		}

		// Validate the driver belongs to the player team
		const playerDrivers = this.playerTeam.getAllDrivers();
		if (!playerDrivers.includes(driver)) {
			this.log('debug', 'Driver does not belong to player team');
			return false;
		}

		const card = driver.hand[cardIndex];
		const cardBlocker = this.getCardBlocker({ driver, card });
		if (cardBlocker) {
			this.log('general', `Cannot play card: ${cardBlocker}`);
			return false;
		}
		if (!this.validateTarget(card, driver, targetVehicle)) {
			this.log('general', `Invalid target for card "${card.name}" (type: ${card.targetType}). Driver: ${this.getDriverDisplayName(driver)}, Target: ${targetVehicle ? targetVehicle.name : 'undefined'}`,
				undefined, targetVehicle ? `${card.displayName} can't target ${targetVehicle.name}` : `${card.displayName} needs a target`);
			return false;
		}
		if (targetOccupant && !(targetVehicle && [targetVehicle.driver, targetVehicle.passenger].includes(targetOccupant))) {
			this.log('general', `Cannot play card: ${targetOccupant.metadata.name} is not aboard ${targetVehicle?.name ?? 'the target'}`);
			return false;
		}
		const carrier = this.isAttackOrder(card) && targetVehicle ? this.orderCarrier({ card, target: targetVehicle }) : null;

		const adrenalineBefore = driver.adrenaline;
		const result = driver.playCardWithCost(cardIndex);
		if (!result.success) {
			this.log('general', `Cannot play card: ${result.reason}`);
			return false;
		}

		// Log card play with adrenaline info
		this.logAbout({
			type: 'card_played',
			driver,
			say: (name) => `${name} plays ${card.displayName}`,
			detail: ` (Adrenaline: ${adrenalineBefore} -> ${driver.adrenaline})`,
			metadata: { driver: driver.metadata.name, card: card.displayName, adrenalineBefore, adrenalineAfter: driver.adrenaline },
		});

		this.resolvePlayedCard({ card, caster: driver, target: targetVehicle ?? null, occupant: targetOccupant ?? null, carrier });

		// Emit card played event
		this.emit('cardPlayed', Object.freeze({
			driver,
			card,
			targetVehicle
		}));

		// Check if battle is over
		this.checkBattleStatus();

		// Emit state change
		this.emit('stateChanged', this.getState());

		return true;
	}

	/**
	 * Shield lasts until the start of the player's next turn, on both sides,
	 * so a Shield given on the player's turn covers exactly the enemy turn
	 * after it
	 */
	private clearShields(): void {
		this.playerTeam.clearShields();
		this.enemyTeam.clearShields();
	}

	/**
	 * Why a card can't be played at all right now, whatever its target, or
	 * null if it can. The driver's own checks (life, cost, the passenger
	 * gate) are Driver.getPlayBlocker; these need the convoy. A signature
	 * card needs a living escort of its type, and Rally the Convoy a ready
	 * escort to fire.
	 */
	public getCardBlocker({ driver, card }: { driver: Driver; card: Card }): string | null {
		const escorts = this.getTeamForDriver(driver)?.escorts ?? [];
		const signatureOf = card.signatureOf;
		if (signatureOf && !escorts.some(escort => !escort.isOutOfFight && escort.escort?.type === signatureOf)) {
			return `${card.name} needs a living ${ESCORT_CONFIGS[signatureOf].name} in the convoy`;
		}
		if (card.isOrder && card.targetType === 'enemy_all' && !escorts.some(escort => escort.isReady)) {
			return `${card.name} needs a ready escort`;
		}
		return null;
	}

	/**
	 * Whether a driver could play this card now, given a legal target
	 */
	public canPlayCard({ driver, card }: { driver: Driver; card: Card }): boolean {
		return driver.canPlayCard(card) && this.getCardBlocker({ driver, card }) === null;
	}

	/**
	 * Why this driver's card can't go on this target, or null if it can:
	 * the same rule playCard checks, for the combat screen's highlights
	 */
	public getTargetBlocker({ driver, card, target }: { driver: Driver; card: Card; target: Vehicle }): string | null {
		const casterVehicle = this.getVehicleForDriver(driver);
		if (!casterVehicle) return `${driver.metadata.name} is not in a vehicle`;
		return new BoardProjection({ battle: this }).targetBlocker({ card, caster: casterVehicle, target });
	}

	/**
	 * The escort that would carry out an attack order on this raider, or
	 * null if none can. See BoardProjection.orderCarrier.
	 */
	public orderCarrier({ card, target }: { card: Card; target: Vehicle }): Vehicle | null {
		return new BoardProjection({ battle: this }).orderCarrier({ card, target });
	}

	/**
	 * An order that targets a raider and is carried out by the nearest ready
	 * escort (Covering Fire, Ramming Run, Run Ahead, Flag Down)
	 */
	public isAttackOrder(card: Card): boolean {
		return card.isOrder && card.targetType === 'enemy_single';
	}

	/**
	 * Resolve a card the player just paid for. An attack order acts through
	 * its carrier and spends it; Rally the Convoy acts through every ready
	 * escort; a buff order that spends (Draw Fire) spends the escort it
	 * targets. Everything else resolves from the caster's own vehicle.
	 */
	private resolvePlayedCard({
		card,
		caster,
		target,
		occupant,
		carrier
	}: {
		card: Card;
		caster: Driver;
		target: Vehicle | null;
		occupant: Driver | null;
		carrier: Vehicle | null;
	}): void {
		if (carrier && target) {
			this.log('general', `${carrier.name} carries out ${card.displayName} on ${target.name}`,
				{ vehicle: carrier.name, card: card.displayName, target: target.name });
			this.applyCardEffects({ card, caster, target, actor: carrier });
			if (card.spendsEscort) carrier.spent = true;
			return;
		}
		if (card.isOrder && card.targetType === 'enemy_all') {
			this.rallyConvoy({ card, caster });
			return;
		}
		this.applyCardEffects({ card, caster, target, occupant });
		if (card.isOrder && card.spendsEscort && target?.isEscort) {
			target.spent = true;
		}
	}

	/**
	 * Every ready escort acts, one at a time in roster order, on the nearest
	 * raider still in the fight within the card's range, picked again for
	 * each escort so a raider an earlier one wrecked isn't shot twice. Then
	 * every escort is spent, including any with nothing in range.
	 */
	private rallyConvoy({ card, caster }: { card: Card; caster: Driver }): void {
		const escorts = this.getTeamForDriver(caster)?.escorts ?? [];
		const range = cardRange(card) ?? 0;
		for (const escort of escorts.filter(candidate => candidate.isReady)) {
			const raider = new BoardProjection({ battle: this }).nearestEnemyInRange({ from: escort, range });
			if (!raider) {
				this.log('general', `${escort.name} has no raider within range ${range}`, { vehicle: escort.name, card: card.displayName });
				continue;
			}
			this.log('general', `${escort.name} fires on ${raider.name}`, { vehicle: escort.name, card: card.displayName, target: raider.name });
			this.applyCardEffects({ card, caster, target: raider, actor: escort });
		}
		escorts.forEach(escort => { escort.spent = true; });
	}

	/**
	 * End the player's turn and play the enemy's. By default the whole enemy
	 * turn plays now, up to the player's next draw: the simulator's, the AI's
	 * and every headless caller's path. With `stepEnemyTurn` the raiders'
	 * actions wait for stepEnemyTurn, one per call, so a screen can pace them.
	 */
	public endPlayerTurn({ stepEnemyTurn = false }: { stepEnemyTurn?: boolean } = {}): void {
		if (!this.isPlayerTurn || this.battleOver) {
			return;
		}

		// Log player hands before discarding
		this.log('debug', '=== PLAYER FINAL HANDS ===');
		this.playerTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('debug', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});

		// Discard hands for all player drivers
		this.playerTeam.discardAllHands();

		// Start enemy turn
		this.isPlayerTurn = false;

		this.log('turn_end', 'Ending player turn');

		// Log leftover adrenaline for player drivers
		const playerDrivers = this.playerTeam.getAllDrivers();
		for (const driver of playerDrivers) {
			if (driver.isAlive() && driver.adrenaline > 0) {
				this.log('adrenaline_remaining', 
					`${this.getDriverDisplayName(driver)} ended turn with ${driver.adrenaline} adrenaline remaining`,
					{ driver: driver.metadata.name, value: driver.adrenaline }
				);
			}
		}

		this.dropBackFlankers();
		this.clearWrecks();

		// Emit turn ended event
		this.emit('turnEnded', Object.freeze({ team: 'player' }));

		this.beginEnemyTurn();
		if (!stepEnemyTurn) this.runEnemyTurn();
	}

	/**
	 * Every raider commits its whole coming turn now, at the start of the
	 * player's turn, against the hand it just drew. The enemy turn plays the
	 * plan instead of choosing fresh. Public so a test that rigs a hand can
	 * plan again.
	 */
	public planEnemyTurn(): void {
		Battle.enemyPlans.set(this, this.aiController.planEnemyTurn());
	}

	/**
	 * A raider's committed cards for the coming enemy turn, in play order.
	 */
	public getPlan(raider: Vehicle): readonly PlannedAction[] {
		return Battle.enemyPlans.get(this)?.get(raider) ?? [];
	}

	/**
	 * What the player sees of every raider's plan, judged from one projection
	 * of the enemy turn (projectEnemyTurn). Values are worked out now, so a
	 * Vulnerable the player picks up this turn shows in the number. Elites
	 * and bosses hide the value and the card. A card that will fizzle shows
	 * nothing, and neither does a raider that will drop its plan or is
	 * stunned. Read this once when showing several raiders.
	 */
	public getAllIntents(): Map<Vehicle, Intent[]> {
		const intents = new Map<Vehicle, Intent[]>();
		for (const [raider, actions] of this.projectEnemyTurn()) {
			intents.set(raider, actions.map(projected => this.intentOf({ raider, ...projected })));
		}
		return intents;
	}

	/**
	 * One raider's intents, as getAllIntents shows them
	 */
	public getIntents(raider: Vehicle): Intent[] {
		return this.getAllIntents().get(raider) ?? [];
	}

	private intentOf({ raider, action, target, targetSpeed }: { raider: Vehicle } & ProjectedAction): Intent {
		const hidden = (raider.intentTier ?? IntentTier.BASIC) !== IntentTier.BASIC;
		const type = intentTypeOf(action.card);
		let amount: number | null = null;
		let label: string | null = null;
		if (type === IntentType.ATTACK) {
			amount = this.previewDamage({ raider, action, target, targetSpeed });
		} else if (type === IntentType.DEFEND) {
			amount = defendAmountOf(action.card);
		} else if (type === IntentType.DEBUFF) {
			label = debuffLabelOf(action.card);
		} else if (type === IntentType.BUFF) {
			label = buffLabelOf(action.card);
		}
		return {
			type,
			amount: hidden ? null : amount,
			hits: 1,
			label: hidden ? null : label,
			target: action.card.targetType === 'enemy_all' ? 'both' : target?.id ?? null,
			description: hidden ? '???' : action.card.displayName
		};
	}

	/**
	 * A projection of the board as the enemy turn will find it before any
	 * raider acts, if the player's turn ended now: flankers that will drop
	 * back are in their reserved slots (dropBackSlotOf, which
	 * dropBackFlankers uses too), and wrecks are off the road. Planning and
	 * the preview both start from it, so a raider doesn't plan from a
	 * shoulder it's expected to lose as the board stands. The player can
	 * still change that before the turn ends.
	 */
	public projectEnemyTurnStart(): BoardProjection {
		const board = new BoardProjection({ battle: this });
		for (const vehicle of this.getAllVehicles()) {
			if (vehicle.isOutOfFight) {
				board.leaveRoad(vehicle);
			} else if (this.dropBackSlotOf(vehicle)) {
				board.dropBack(vehicle);
			}
		}
		return board;
	}

	/**
	 * Each raider's planned cards as the enemy turn will play them. A plan
	 * records where the raider stands for each card as the board stood when
	 * it was made; the player can change that before it plays, say by
	 * outpacing a flanker so it drops back. So the plans are replayed from
	 * projectEnemyTurnStart in the order the enemy turn plays them (stepEnemyTurn), each
	 * card judged by the same checks play makes, on the projection: a flank
	 * or boost earlier in a raider's own plan moves it from where it really
	 * starts, and a card that will fizzle is left out and changes nothing on
	 * the board. A raider that will drop its plan, or is stunned and skips
	 * its turn, has no entry, and its cards change nothing on the board.
	 */
	private projectEnemyTurn(): Map<Vehicle, ProjectedAction[]> {
		const board = this.projectEnemyTurnStart();
		const projected = new Map<Vehicle, ProjectedAction[]>();
		for (const [raider, plan] of Battle.enemyPlans.get(this) ?? []) {
			if (raider.isStunned) continue;
			const actions: ProjectedAction[] = [];
			for (const planned of plan) {
				if (!raider.isAlive() || !planned.driver.isAlive() || raider.driver !== planned.driver) break;
				const { card, driver } = planned;
				if (!board.handOf(driver).includes(card)) continue;
				const action: PlannedAction = {
					...planned,
					slot: board.slotOf(raider),
					flanking: board.isFlanking(raider),
					speed: board.speedOf(raider)
				};
				const target = this.plannedTarget({ raider, action, board });
				if (target && card.targetType !== 'enemy_all' && this.plannedCardFizzles({ raider, card, target, board })) continue;
				actions.push({ action, target, targetSpeed: target ? board.speedOf(target) : 0 });
				board.apply({ card, driver, target });
			}
			if (actions.length > 0) projected.set(raider, actions);
		}
		return projected;
	}

	/**
	 * Where a planned card is headed, judged the way the enemy turn will play
	 * it, on the board projectEnemyTurn has brought up to the moment the card
	 * plays: a wrecked target is followed to the vehicle its survivors ride
	 * in, then the escort drawing fire in that vehicle's row takes it if the
	 * card could reach it from where the raider will be. This is what the
	 * target marks and the end-turn preview show.
	 */
	private plannedTarget({ raider, action, board }: { raider: Vehicle; action: PlannedAction; board: BoardProjection }): Vehicle | null {
		if (!action.target) return null;
		const target = action.target.isAlive() ? action.target : this.followWreck(action.target) ?? action.target;
		return this.drawFireRedirect({ raider, card: action.card, target, board }) ?? target;
	}

	/**
	 * Whether a planned card at the target plannedTarget found will fizzle,
	 * by the checks playPlannedAction makes: a wreck nobody rode away from,
	 * nobody aboard, or getPlannedCardBlocker on the projected board.
	 */
	private plannedCardFizzles({ raider, card, target, board }: { raider: Vehicle; card: Card; target: Vehicle; board: BoardProjection }): boolean {
		return target.isUnmanned() || this.getPlannedCardBlocker({ card, caster: raider, target, board }) !== null;
	}

	/**
	 * The escort under Draw Fire that takes this card instead of its target,
	 * or null. Draw Fire pulls aimed fire: single-target cards that land
	 * something on any other player vehicle in the escort's row, driven,
	 * hauler, or escort (escorts.md decision 48). It never pulls a blast, so
	 * an area hit (`enemy_all`) lands on everything it would have, as planned
	 * (decision 29). A card with nothing landing on its target (a flank)
	 * keeps its target too. Rows are judged as they stand, and the last Draw
	 * Fire played on the row wins. It never cancels: a card that can't reach
	 * the escort keeps its target. `board` is where everyone stands for the
	 * check: the live board in play, or the projected one for the preview.
	 */
	private drawFireRedirect({
		raider,
		card,
		target,
		board = new BoardProjection({ battle: this })
	}: {
		raider: Vehicle;
		card: Card;
		target: Vehicle;
		board?: BoardProjection;
	}): Vehicle | null {
		// Aimed fire only, never a blast
		if (card.targetType === 'enemy_all' || !landsOnTarget(card)) return null;
		const covers = Battle.drawFireCovers.get(this) ?? [];
		const row = board.slotOf(target)?.row;
		if (covers.length === 0 || !row || target.isOutOfFight || !this.playerTeam.vehicles.includes(target)) {
			return null;
		}

		// The last living cover on the row: a wrecked one hides nothing, and
		// after clearWrecks it has no slot, so preview and play agree. A shot
		// at that cover is already where Draw Fire wants it.
		const escort = [...covers].reverse().find(cover =>
			!cover.isOutOfFight && board.slotOf(cover)?.row === row && this.playerTeam.vehicles.includes(cover));
		if (!escort || escort === target) return null;
		return this.getPlannedCardBlocker({ card, caster: raider, target: escort, board }) === null ? escort : null;
	}

	/**
	 * Damage per hit a planned attack deals if it lands, from the raider's
	 * flank state and speed and the target's speed when the card plays
	 * (projectEnemyTurn). Vulnerable is read from the target as it is now.
	 */
	private previewDamage({
		raider,
		action,
		target,
		targetSpeed
	}: {
		raider: Vehicle;
		action: PlannedAction;
		target: Vehicle | null;
		targetSpeed: number;
	}): number {
		const effect = attackEffectOf(action.card);
		if (!effect) return 0;
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		if (effect.formula && typeof effect.formula === 'string' && target) {
			damage = this.calculateFormulaDamage(effect.formula, {
				base: damage,
				armor: raider.armor,
				speedDiff: action.speed - targetSpeed
			});
		}
		return this.applyDamageModifiers(damage, action.flanking, target);
	}

	/**
	 * Queue every raider's plan for the enemy turn, one raider's cards after
	 * another, in plan order
	 */
	private beginEnemyTurn(): void {
		const plans = Battle.enemyPlans.get(this) ?? new Map<Vehicle, PlannedAction[]>();
		Battle.enemyPlans.delete(this);
		const actions: EnemyTurnQueue['actions'] = [];
		for (const [raider, plan] of plans) {
			for (const action of plan) actions.push({ raider, action });
		}
		Battle.enemyTurns.set(this, { actions, dropped: new Set() });
	}

	/**
	 * True from the end of the player's turn until the enemy turn's last step
	 * has been played, or the battle ends. The player's next draw comes after.
	 */
	public get enemyTurnInProgress(): boolean {
		return Battle.enemyTurns.has(this);
	}

	/**
	 * Play the next raider action of the enemy turn and return it. Once
	 * every action has played, the call after the last one ends the enemy
	 * turn (wrecks off the road, the player's draw) and returns null, as it
	 * does when no enemy turn is under way or the battle has ended. A raider
	 * that drops the rest of its plan (wrecked, lost its driver, stunned) is
	 * one step; its remaining cards are skipped without one.
	 */
	public stepEnemyTurn(): EnemyTurnStep | null {
		const turn = Battle.enemyTurns.get(this);
		if (!turn) return null;
		if (this.battleOver) {
			Battle.enemyTurns.delete(this);
			return null;
		}

		let next = turn.actions.shift();
		while (next && turn.dropped.has(next.raider)) next = turn.actions.shift();
		if (!next) {
			Battle.enemyTurns.delete(this);
			this.finishEnemyTurn();
			return null;
		}

		const { raider, action } = next;
		const dropReason = Battle.planDropReason(raider, action);
		if (dropReason) {
			this.log('general', `${raider.name} ${dropReason}`, { vehicle: raider.name });
			turn.dropped.add(raider);
			return { raider, card: null, target: null, outcome: 'dropped' };
		}

		const step = this.playPlannedAction(raider, action);
		this.checkBattleStatus();
		if (this.battleOver) Battle.enemyTurns.delete(this);
		return step;
	}

	/**
	 * Play whatever is left of the enemy turn at once, through to the
	 * player's next draw, or the end of the battle
	 */
	public runEnemyTurn(): void {
		while (this.enemyTurnInProgress) this.stepEnemyTurn();
	}

	/**
	 * Why a raider gives up the rest of its plan before this card, or null.
	 * A stunned raider skips its turn.
	 */
	private static planDropReason(raider: Vehicle, action: PlannedAction): string | null {
		if (!raider.isAlive()) return 'is wrecked and drops its plan';
		if (!action.driver.isAlive() || raider.driver !== action.driver) return 'lost its driver and drops its plan';
		if (raider.isStunned) return 'is stunned and skips its turn';
		return null;
	}

	/**
	 * After the raiders' last action: the turn's logs, flankers back and
	 * wrecks off the road, then the player's turn and its draw
	 */
	private finishEnemyTurn(): void {
		// Log enemy hands before ending turn
		this.log('debug', '=== ENEMY FINAL HANDS ===');
		this.enemyTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('debug', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});

		this.log('turn_end', 'Ending enemy turn');

		// Log leftover adrenaline for enemy drivers
		const aliveEnemyDrivers = this.enemyTeam.getAllDrivers();
		for (const driver of aliveEnemyDrivers) {
			if (driver.isAlive() && driver.adrenaline > 0) {
				this.log('adrenaline_remaining',
					`${this.getDriverDisplayName(driver)} ended turn with ${driver.adrenaline} adrenaline remaining`,
					{ driver: driver.metadata.name, value: driver.adrenaline }
				);
			}
		}

		this.dropBackFlankers();
		this.clearWrecks();

		// Draw Fire lasts until the end of the next enemy turn, which is this one
		Battle.drawFireCovers.delete(this);

		// End enemy turn, start player turn
		this.startPlayerTurn();
	}

	/**
	 * Play one planned card. It's spent either way. A target wrecked since
	 * the plan was made is followed to the vehicle that whoever got out of it
	 * now rides in, driving or as a passenger; anything else that makes the card illegal (the target has
	 * nobody aboard, the player moved out of range, outpaced a flank, or a
	 * flanker dropped back) makes it fizzle. See docs/AI_TECHNICAL_DECISIONS/enemy-intent-planning.md.
	 */
	private playPlannedAction(raider: Vehicle, action: PlannedAction): EnemyTurnStep {
		const { card, driver } = action;
		const step = (outcome: EnemyTurnStep['outcome'], target: Vehicle | null): EnemyTurnStep => ({ raider, card, target, outcome });
		const adrenalineBefore = driver.adrenaline;
		const result = driver.playCardWithCost(driver.hand.indexOf(card));
		if (!result.success) {
			this.log('general', `${raider.name} can't play ${card.displayName}: ${result.reason}`, { vehicle: raider.name, card: card.displayName });
			return step('fizzled', action.target);
		}

		this.log('card_played',
			`${this.getDriverDisplayName(driver)} plays ${card.displayName} (Adrenaline: ${adrenalineBefore} -> ${driver.adrenaline})`,
			{ driver: driver.metadata.name, card: card.displayName, adrenalineBefore, adrenalineAfter: driver.adrenaline },
			`${raider.name} plays ${card.displayName}`
		);

		// An area hit lands as planned; Draw Fire never pulls it
		if (card.targetType === 'enemy_all' || !action.target) {
			this.applyCardEffects({ card, caster: driver, target: null });
			return step('played', null);
		}

		let target: Vehicle | null = action.target;
		if (!target.isAlive()) {
			const wreck: Vehicle = target;
			target = this.followWreck(wreck);
			if (!target) {
				const why = Team.survivorsOf(wreck).length === 0 ? 'nobody got out' : 'nobody who got out is still in the fight';
				this.log('fizzle', `${raider.name}'s ${card.displayName} fizzles: ${wreck.name} is wrecked and ${why}`,
					{ vehicle: raider.name, card: card.displayName, target: wreck.name });
				return step('fizzled', wreck);
			}
			this.log('general', `${wreck.name} is wrecked, so ${raider.name} turns ${card.displayName} on ${target.name}`,
				{ vehicle: raider.name, card: card.displayName, target: target.name });
		}
		if (target.isUnmanned()) {
			this.log('fizzle', `${raider.name}'s ${card.displayName} fizzles: ${target.name} has nobody aboard`,
				{ vehicle: raider.name, card: card.displayName, target: target.name });
			return step('fizzled', target);
		}

		const cover = this.drawFireRedirect({ raider, card, target });
		if (cover) {
			this.log('general', `${cover.name} draws ${raider.name}'s ${card.displayName} away from ${target.name}`,
				{ vehicle: raider.name, card: card.displayName, target: cover.name });
			target = cover;
		}

		const reason = this.getPlannedCardBlocker({ card, caster: raider, target });
		if (reason) {
			this.log('fizzle', `${raider.name}'s ${card.displayName} fizzles: ${reason}`,
				{ vehicle: raider.name, card: card.displayName, target: target.name });
			return step('fizzled', target);
		}

		this.applyCardEffects({ card, caster: driver, target });
		return step('played', target);
	}

	/**
	 * Where a card planned at a wreck goes: the vehicle in the fight that
	 * someone who got out of it now rides in, or null. Play and the preview
	 * both follow wrecks through this.
	 */
	private followWreck(wreck: Vehicle): Vehicle | null {
		return this.findVehicleCarrying(Team.survivorsOf(wreck));
	}

	/**
	 * The vehicle in the fight that the first of these drivers still alive
	 * rides in, driving or as a passenger
	 */
	private findVehicleCarrying(drivers: readonly Driver[]): Vehicle | null {
		for (const driver of drivers.filter(candidate => candidate.isAlive())) {
			const vehicle = this.getVehicleForDriver(driver);
			if (vehicle && !vehicle.isOutOfFight) {
				return vehicle;
			}
		}
		return null;
	}

	/**
	 * Why a planned card can no longer be played on its target, in words for
	 * the log, or null if it still can. Slots, speeds, and the flank rules are
	 * read from `board`: the live board in play, or the projected one for the
	 * preview (projectEnemyTurn).
	 */
	private getPlannedCardBlocker({
		card,
		caster,
		target,
		board = new BoardProjection({ battle: this })
	}: {
		card: Card;
		caster: Vehicle;
		target: Vehicle;
		board?: BoardProjection;
	}): string | null {
		if (target.isOutOfFight) {
			return `${target.name} is out of the fight`;
		}
		const casterSlot = board.slotOf(caster);
		const targetSlot = board.slotOf(target);
		for (const effect of card.effects) {
			if (typeof effect.range === 'number') {
				if (!casterSlot || !targetSlot) {
					return `${target.name} is not on the road`;
				}
				const range = slotRange(casterSlot, targetSlot);
				if (range > effect.range) {
					return `${target.name} is out of range (${range} away, needs ${effect.range})`;
				}
			}
			if (effect.condition === 'target_flanking' && !(targetSlot && isShoulder(targetSlot.lane))) {
				return `${target.name} is no longer flanking`;
			}
		}
		const flankBlocker = cardFlanks(card) ? board.flankBlocker(caster, target) : null;
		if (flankBlocker) {
			return flankBlocker;
		}
		if (card.hitsDriverOnly && !target.driverOnlyTarget) {
			return `${target.name} has nobody aboard to hit`;
		}
		return null;
	}

	/**
	 * Start the player's turn
	 */
	private startPlayerTurn(): void {
		// Increment turn counter
		this.turn++;

		// Check if max turns exceeded
		if (this.maxTurns && this.turn > this.maxTurns) {
			this.battleOver = true;
			this.battleTied = true;
			this.log('battle_end', 'Battle ended in a tie: Maximum turns exceeded');
			this.endCombat();
			this.emit('battleEnded', Object.freeze({ winner: 'tie', reason: 'maxTurns' }));
			return;
		}

		// Process status effects for all vehicles
		this.playerTeam.processStatusEffects();
		this.enemyTeam.processStatusEffects();
		
		// Discard remaining cards before drawing new ones
		this.playerTeam.discardAllHands();
		this.enemyTeam.discardAllHands();

		// Refill adrenaline for all drivers
		this.playerTeam.refillAdrenaline();
		this.enemyTeam.refillAdrenaline();

		this.playerTeam.readyEscorts();
		this.clearShields();

		this.drawTurnHands();

		// Set turn state
		this.isPlayerTurn = true;

		this.planEnemyTurn();

		this.log('turn_start', `Player turn ${this.turn} started`, { turn: this.turn });
		
		// Log hands for all drivers
		this.logAllHands();
		
		// Log team status at turn start
		this.logTeamStatus();
		
		// Emit state change so UI updates
		this.emit('stateChanged', this.getState());
	}

	/**
	 * Resolve a card's effects in order. Draws, adrenaline, and moves are the
	 * caster's and happen once. The rest land where their own target field
	 * says (see EffectTargets): the caster, the card's target, or every enemy
	 * still in the fight. The target is null for a card that takes none.
	 *
	 * The actor is the vehicle doing it: the caster's own, or the escort
	 * carrying out an order, whose slot, speed, and skills the card then
	 * uses. An `on_hit` effect (Ramming Run's self damage) happens only if an
	 * earlier effect landed on someone else.
	 */
	private applyCardEffects({
		card,
		caster,
		target,
		actor = this.getVehicleForDriver(caster),
		occupant = null
	}: {
		card: Card;
		caster: Driver;
		target: Vehicle | null;
		actor?: Vehicle | null;
		occupant?: Driver | null;
	}): void {
		const casterTeam = this.getTeamForDriver(caster);
		const enemies = casterTeam === this.playerTeam ? this.enemyTeam.vehicles : this.playerTeam.vehicles;
		let landed = false;

		for (const effect of card.effects) {
			if (effect.on_hit && !landed) continue;
			if (isCasterAction(effect)) {
				if (!this.applyCasterAction({ card, effect, caster, casterVehicle: actor, target })) return;
				continue;
			}
			const onCaster = effectRecipientOf({ effect, card }) === EffectRecipient.CASTER;
			for (const recipient of effectRecipients({ effect, card, caster: actor, target, enemies })) {
				const took = this.applyEffect({ card, effect, caster, casterVehicle: actor, recipient, occupant });
				if (took && !onCaster) landed = true;
			}
		}
	}

	/**
	 * Who an effect for one person aboard lands on: the occupant the player
	 * picked if they're aboard and alive, otherwise the driver, or the
	 * passenger riding in an escort
	 */
	private static occupantOf(vehicle: Vehicle, picked: Driver | null): Driver | null {
		const aboard = [vehicle.driver, vehicle.passenger].filter((occupant): occupant is Driver => occupant?.isAlive() ?? false);
		return aboard.find(occupant => occupant === picked) ?? aboard[0] ?? null;
	}

	/**
	 * A draw, adrenaline gain, or move: once per card, by the caster. False
	 * when the rest of the card is cancelled (a failed flank).
	 */
	private applyCasterAction({
		card,
		effect,
		caster,
		casterVehicle,
		target
	}: {
		card: Card;
		effect: CardEffect;
		caster: Driver;
		casterVehicle: Vehicle | null;
		target: Vehicle | null;
	}): boolean {
		switch (effect.type) {
			case 'draw':
			case 'draw_cards':
				this.drawForCard(card, caster, typeof effect.value === 'number' ? effect.value : 0);
				break;

			case 'adrenaline':
			case 'gain_resource': {
				if (effect.type === 'gain_resource' && effect.resource !== 'adrenaline') break;
				const adrenalineValue = typeof effect.value === 'number' ? effect.value : 0;
				const beforeAdrenaline = caster.adrenaline;
				const maxAdrenaline = caster.maxAdrenaline;

				caster.gainAdrenaline(adrenalineValue);

				const afterAdrenaline = caster.adrenaline;
				const line = `${card.displayName} gives ${afterAdrenaline - beforeAdrenaline} adrenaline to ${caster.metadata.name}`;
				this.log('general',
					`${line} (Adrenaline: ${beforeAdrenaline}/${maxAdrenaline} -> ${afterAdrenaline}/${maxAdrenaline})`,
					{ card: card.displayName, driver: caster.metadata.name, value: adrenalineValue },
					line
				);
				break;
			}

			case 'change_position':
				// A failed flank cancels the rest of the card, so no bonus without the swerve
				if (casterVehicle && effect.position === 'flanking' && !this.flankVehicle(casterVehicle, target)) {
					return false;
				}
				break;
		}
		return true;
	}

	/**
	 * One effect on one recipient. True when it took hold: out of range, a
	 * miss, or nobody to land on is false.
	 */
	private applyEffect({
		card,
		effect,
		caster,
		casterVehicle,
		recipient,
		occupant
	}: {
		card: Card;
		effect: CardEffect;
		caster: Driver;
		casterVehicle: Vehicle | null;
		recipient: Vehicle;
		occupant: Driver | null;
	}): boolean {
		const onCaster = effectRecipientOf({ effect, card }) === EffectRecipient.CASTER;
		// Out of the fight covers a recipient an earlier effect of this card wrecked
		if (!onCaster && recipient.isOutOfFight) return false;

		switch (effect.type) {
			case 'damage':
				return this.applyDamage({ card, effect, caster, casterVehicle, recipient, onCaster });

			case 'heal': {
				const healValue = typeof effect.value === 'number' ? effect.value : 0;
				const beforeStructure = recipient.structure;
				const beforeArmor = recipient.armor;

				recipient.repair(healValue, effect.overflow_to_armor === true);

				const structureHealed = recipient.structure - beforeStructure;
				const armorHealed = recipient.armor - beforeArmor;
				const structureText = `${beforeStructure}/${recipient.maxStructure} -> ${recipient.structure}/${recipient.maxStructure}`;
				const armorText = `${beforeArmor}/${recipient.maxArmor} -> ${recipient.armor}/${recipient.maxArmor}`;
				const line = `${card.displayName} repairs ${structureHealed} structure and ${armorHealed} armor on ${recipient.name}`;
				this.log('heal_applied',
					`${line} (Structure: ${structureText}, Armor: ${armorText})`,
					{ card: card.displayName, target: recipient.name, value: healValue },
					line
				);
				break;
			}

			case 'heal_driver': {
				const patient = Battle.occupantOf(recipient, occupant);
				if (!patient) return false;
				const healValue = typeof effect.value === 'number' ? effect.value : 0;
				const beforeHP = patient.hitpoints;
				const maxHP = patient.maxHitpoints;

				patient.heal(healValue);

				const afterHP = patient.hitpoints;
				this.logAbout({
					type: 'heal_applied',
					driver: patient,
					say: (name) => `${card.displayName} heals ${afterHP - beforeHP} hit points on ${name}`,
					detail: ` (HP: ${beforeHP}/${maxHP} -> ${afterHP}/${maxHP})`,
					metadata: { card: card.displayName, target: patient.metadata.name, value: healValue },
				});
				break;
			}

			case 'armor':
			case 'gain_armor': {
				const armorValue = typeof effect.value === 'number' ? effect.value : 0;
				const beforeArmor = recipient.armor;

				recipient.addArmor(armorValue);

				const armorText = `${beforeArmor}/${recipient.maxArmor} -> ${recipient.armor}/${recipient.maxArmor}`;
				const line = `${card.displayName} adds ${recipient.armor - beforeArmor} armor to ${recipient.name}`;
				this.log('armor_gained',
					`${line} (Armor: ${armorText})`,
					{ card: card.displayName, target: recipient.name, value: armorValue },
					line
				);
				break;
			}

			case 'gain_shield': {
				const shieldValue = typeof effect.value === 'number' ? effect.value : 0;
				const beforeShield = recipient.shield ?? 0;
				recipient.addShield(shieldValue);
				const line = `${card.displayName} gives ${recipient.name} ${shieldValue} shield`;
				this.log('armor_gained',
					`${line} (Shield: ${beforeShield} -> ${recipient.shield ?? 0})`,
					{ card: card.displayName, target: recipient.name, value: shieldValue },
					line
				);
				break;
			}

			case 'status':
			case 'apply_status':
				return this.applyStatus({ card, effect, caster, casterVehicle, recipient });

			case 'grant_adrenaline': {
				const fueled = Battle.occupantOf(recipient, occupant);
				if (!fueled) return false;
				const before = fueled.adrenaline;
				fueled.gainAdrenaline(typeof effect.value === 'number' ? effect.value : 0);
				this.logAbout({
					type: 'general',
					driver: fueled,
					say: (name) => `${card.displayName} gives ${fueled.adrenaline - before} adrenaline to ${name}`,
					detail: ` (Adrenaline: ${before}/${fueled.maxAdrenaline} -> ${fueled.adrenaline}/${fueled.maxAdrenaline})`,
					metadata: { card: card.displayName, driver: fueled.metadata.name, value: effect.value },
				});
				break;
			}

			case 'draw_fire': {
				// Last one played wins its row, so a repeat moves to the end
				const covers = (Battle.drawFireCovers.get(this) ?? []).filter(cover => cover !== recipient);
				Battle.drawFireCovers.set(this, [...covers, recipient]);
				this.log('status_applied',
					`${recipient.name} draws fire: until the end of the next enemy turn, raider cards aimed at your other vehicles in its row turn on it if they can reach it`,
					{ card: card.displayName, target: recipient.name, status: 'draw_fire' }
				);
				break;
			}
		}
		return true;
	}

	/**
	 * Damage on one recipient. An attack on someone else checks range, rolls
	 * to hit unless it always hits, and takes the flank and Vulnerable
	 * bonuses. Damage on the caster (Berserker) is none of those: it lands
	 * as printed, on the caster's driver for self_driver.
	 */
	private applyDamage({
		card,
		effect,
		caster,
		casterVehicle,
		recipient,
		onCaster
	}: {
		card: Card;
		effect: CardEffect;
		caster: Driver;
		casterVehicle: Vehicle | null;
		recipient: Vehicle;
		onCaster: boolean;
	}): boolean {
		let damage = typeof effect.value === 'number' ? effect.value : 0;

		if (onCaster) {
			if (effect.target === 'self_driver') {
				this.damageDriver({ driver: caster, vehicle: recipient, damage, card });
			} else {
				this.damageVehicle({ vehicle: recipient, damage, card, structureOnly: effect.structure_only === true });
			}
		} else {
			if (typeof effect.range === 'number' && casterVehicle) {
				const range = this.calculateRange(casterVehicle, recipient);
				if (range > effect.range) {
					this.log('out_of_range',
						`${card.displayName} cannot reach ${recipient.name} - requires range ${effect.range}, but target is at range ${range}`,
						{ card: card.displayName, target: recipient.name, requiredRange: effect.range, actualRange: range }
					);
					return false;
				}
			}

			if (rollsToHit({ effect, card })) {
				const attackType = (typeof effect.attack_type === 'string' ? effect.attack_type : null) ||
					(effect.scaling === 'ramming' ? 'ramming' : 'ranged');
				const modifier = typeof effect.hit_modifier === 'number' ? effect.hit_modifier : 0;
				if (!this.checkHit({ attacker: casterVehicle, caster, defender: recipient, attackType, modifier })) {
					this.log('miss',
						`${card.displayName} misses ${recipient.name}`,
						{ card: card.displayName, target: recipient.name }
					);
					this.emitHit('hitMissed', recipient, null);
					return false;
				}
			}

			if (casterVehicle) {
				if (effect.formula && typeof effect.formula === 'string') {
					damage = this.calculateFormulaDamage(effect.formula, {
						base: damage,
						armor: casterVehicle.armor,
						speedDiff: casterVehicle.speed - recipient.speed
					});
				}
				damage = this.calculateDamage(damage, casterVehicle, recipient);
			}

			if (effect.target === 'driver') {
				// Headshot: the driver, or a passenger riding in an escort. An
				// empty escort isn't a legal target, so this only misses its mark
				// when the last person aboard died earlier in the card.
				const victim = recipient.driverOnlyTarget;
				if (!victim) {
					this.log('fizzle', `${card.displayName} fizzles: ${recipient.name} has nobody aboard to hit`,
						{ card: card.displayName, target: recipient.name });
					return false;
				}
				this.damageDriver({ driver: victim, vehicle: recipient, damage, card });
			} else {
				this.damageVehicle({ vehicle: recipient, damage, card });
			}
		}

		if (!recipient.isAlive()) {
			this.handleWreck(recipient);
		}
		return true;
	}

	/**
	 * Everyone who lived through a wreck jumps to a free seat or crashes out
	 */
	private handleWreck(wreck: Vehicle): void {
		for (const { driver, seat } of this.getTeamForVehicle(wreck)?.handleVehicleDestruction(wreck) ?? []) {
			const event = seat ? `jumps from ${wreck.name} into ${seat.name}` : 'has no free seat and crashes out of the fight';
			this.logAbout({
				type: 'general',
				driver,
				say: (name) => `${name} ${event}`,
				metadata: { driver: driver.metadata.name, ...(seat ? { vehicle: seat.name } : {}) },
			});
		}
	}

	/**
	 * A status on one recipient. One on someone else rolls to hit unless it
	 * always hits; one on the caster just lands.
	 */
	private applyStatus({
		card,
		effect,
		caster,
		casterVehicle,
		recipient
	}: {
		card: Card;
		effect: CardEffect;
		caster: Driver;
		casterVehicle: Vehicle | null;
		recipient: Vehicle;
	}): boolean {
		if (effect.condition === 'target_flanking' && !recipient.isFlanking) {
			return false;
		}
		if (rollsToHit({ effect, card }) && !this.checkHit({ attacker: casterVehicle, caster, defender: recipient })) {
			this.log('miss',
				`${card.displayName} misses ${recipient.name}`,
				{ card: card.displayName, target: recipient.name }
			);
			this.emitHit('hitMissed', recipient, null);
			return false;
		}

		const statusName = effect.status || (effect.description || 'unknown').toLowerCase();
		const speedBefore = recipient.speed;

		recipient.applyStatusEffect({
			name: statusName,
			duration: typeof effect.duration === 'number' ? effect.duration : 1,
			value: typeof effect.value === 'number' ? effect.value : 0,
			description: effect.description
		});

		const line = `${card.displayName} applies ${statusName} to ${recipient.name}`;
		const speedText = SPEED_STATUSES.includes(statusName) ? ` (Speed: ${speedBefore} -> ${recipient.speed})` : '';
		this.log('status_applied',
			line + speedText,
			{ card: card.displayName, target: recipient.name, status: statusName },
			line
		);
		return true;
	}

	/**
	 * Get the team that owns a specific vehicle
	 */
	private getTeamForVehicle(vehicle: Vehicle): Team | null {
		if (this.playerTeam.vehicles.includes(vehicle)) {
			return this.playerTeam;
		}
		if (this.enemyTeam.vehicles.includes(vehicle)) {
			return this.enemyTeam;
		}
		return null;
	}

	/**
	 * Who is aboard a vehicle before a hit, to tell afterwards who it killed
	 */
	private crewOf(vehicle: Vehicle): Crew {
		return {
			driver: vehicle.driver,
			living: [vehicle.driver, vehicle.passenger].filter((occupant): occupant is Driver => occupant?.isAlive() ?? false)
		};
	}

	/**
	 * Damage through shield and armor into structure and whoever is aboard,
	 * logged with where it went. Structure-only damage skips both.
	 */
	private damageVehicle({ vehicle, damage, card, structureOnly = false }: { vehicle: Vehicle; damage: number; card: Card; structureOnly?: boolean }): void {
		const beforeStructure = vehicle.structure;
		const beforeArmor = vehicle.armor;
		const beforeShield = vehicle.shield ?? 0;
		const crew = this.crewOf(vehicle);
		const crewHealth = (): number => crew.living.reduce((sum, occupant) => sum + occupant.hitpoints, 0);
		const beforeCrewHealth = crewHealth();

		if (structureOnly) {
			vehicle.damageStructure(damage);
		} else {
			vehicle.takeDamage(damage);
			this.getTeamForVehicle(vehicle)?.handleDriverDeath(vehicle);
		}

		const split = [
			[beforeShield - (vehicle.shield ?? 0), 'shield'],
			[beforeArmor - vehicle.armor, 'armor'],
			[beforeStructure - vehicle.structure, 'structure'],
			[beforeCrewHealth - crewHealth(), 'occupants']
		] as const;
		const landed = split.filter(([amount]) => amount > 0).map(([amount, where]) => `${amount} to ${where}`);
		const breakdown = landed.length > 0 ? `${damage} total (${landed.join(', ')})` : `${damage} total`;
		const structureText = `${beforeStructure}/${vehicle.maxStructure} -> ${vehicle.structure}/${vehicle.maxStructure}`;
		const armorText = `${beforeArmor}/${vehicle.maxArmor} -> ${vehicle.armor}/${vehicle.maxArmor}`;
		const shieldText = beforeShield > 0 ? `, Shield: ${beforeShield} -> ${vehicle.shield ?? 0}` : '';

		const line = `${card.displayName} deals ${breakdown} damage to ${vehicle.name}`;
		this.log('damage_dealt',
			`${line} (Structure: ${structureText}, Armor: ${armorText}${shieldText})`,
			{ card: card.displayName, target: vehicle.name, value: damage },
			line
		);
		this.emitHit('hitLanded', vehicle, damage);
		this.logDeaths(vehicle, crew);
	}

	/**
	 * Damage that skips the vehicle and lands on one driver (Headshot,
	 * Berserker). A driver it kills leaves their seat.
	 */
	private damageDriver({
		driver,
		vehicle,
		damage,
		card
	}: {
		driver: Driver;
		vehicle: Vehicle | null;
		damage: number;
		card: Card;
	}): void {
		const crew = vehicle ? this.crewOf(vehicle) : null;
		driver.takeDamage(damage);
		this.logAbout({
			type: 'damage_dealt',
			driver,
			say: (name) => `${card.displayName} deals ${damage} damage to ${name}`,
			metadata: { card: card.displayName, target: driver.metadata.name, value: damage },
		});
		if (vehicle) this.emitHit('hitLanded', vehicle, damage);
		if (vehicle && crew) {
			this.getTeamForVehicle(vehicle)?.handleDriverDeath(vehicle);
			this.logDeaths(vehicle, crew);
		}
	}

	/** For the screen's floating numbers; the log carries the detail. */
	private emitHit(event: 'hitLanded' | 'hitMissed', vehicle: Vehicle, damage: number | null): void {
		const hit: HitEvent = { vehicle, damage };
		this.emit(event, Object.freeze(hit));
	}

	/**
	 * Log who a hit killed and who has the wheel now. The vehicle has already
	 * taken the dead out of their seats. A wreck's survivors are logged by
	 * where they jump, not here.
	 */
	private logDeaths(vehicle: Vehicle, crew: Crew): void {
		// A player's driver at 0 HP is down, not dead: their partner revives them if they win (Combat Rules,
		// Losing vehicles and drivers). A raider's death is final.
		const outcome = this.playerTeam.vehicles.includes(vehicle) ? 'is down' : 'is dead';
		for (const occupant of crew.living) {
			if (!occupant.isAlive()) {
				this.logAbout({ type: 'general', driver: occupant, say: (name) => `${name} ${outcome}`, metadata: { driver: occupant.metadata.name } });
			}
		}
		if (!vehicle.isAlive() || vehicle.driver === crew.driver) {
			return;
		}
		if (vehicle.driver) {
			this.logAbout({
				type: 'general',
				driver: vehicle.driver,
				say: (name) => `${name} takes the wheel of ${vehicle.name}`,
				metadata: { driver: vehicle.driver.metadata.name, vehicle: vehicle.name },
			});
		} else if (vehicle.isEscort) {
			this.log('general', `${vehicle.name} has nobody at the wheel and carries on as an escort`, { vehicle: vehicle.name });
		} else {
			this.log('general', `${vehicle.name} has nobody aboard and is out of the fight`, { vehicle: vehicle.name });
		}
	}

	/**
	 * Check if the battle is over
	 */
	private checkBattleStatus(): void {
		if (this.battleOver) return;

		// Check if player team is defeated
		if (this.playerTeam.isDefeated()) {
			this.battleOver = true;
			this.battleWon = false;
			this.log('battle_end', 'Battle lost: All player drivers defeated');
			this.endCombat();
			this.emit('battleEnded', Object.freeze({ won: false }));
			this.emit('stateChanged', this.getState());
			return;
		}

		// Check if enemy team is defeated
		if (this.enemyTeam.isDefeated()) {
			this.battleOver = true;
			this.battleWon = true;
			this.log('battle_end', 'Battle won: All enemy drivers defeated');
			this.endCombat();
			this.emit('battleEnded', Object.freeze({ won: true }));
			this.emit('stateChanged', this.getState());
			return;
		}
	}

	/**
	 * Get battle statistics for display with formatted team data
	 */
	public getBattleStats(): {
		turn: number;
		isPlayerTurn: boolean;
		battleOver: boolean;
		battleWon: boolean;
		playerTeam: ReturnType<Team['getCombatStats']>;
		enemyTeam: ReturnType<Team['getCombatStats']>;
	} {
		return {
			turn: this.turn,
			isPlayerTurn: this.isPlayerTurn,
			battleOver: this.battleOver,
			battleWon: this.battleWon,
			playerTeam: this.playerTeam.getCombatStats(),
			enemyTeam: this.enemyTeam.getCombatStats()
		};
	}

	// getState() is provided by Model base class

	/**
	 * Range between two vehicles: lanes apart plus rows apart on the road.
	 */
	public calculateRange(from: Vehicle, to: Vehicle): number {
		if (!from.slot || !to.slot) {
			throw new Error(`Range needs both vehicles on the road (${from.name}, ${to.name})`);
		}
		return slotRange(from.slot, to.slot);
	}

	/**
	 * Why a vehicle can't flank a target right now, or null if it can. The
	 * target is the vehicle to outrun: it must be in the other team's
	 * formation and slower than the flanker, and the shoulder slot in its
	 * row must be free.
	 */
	public getFlankBlocker(flanker: Vehicle, target: Vehicle): string | null {
		return new BoardProjection({ battle: this }).flankBlocker(flanker, target);
	}

	public canFlank(flanker: Vehicle, target: Vehicle): boolean {
		return this.getFlankBlocker(flanker, target) === null;
	}

	/**
	 * Swerve onto the other team's shoulder in the row of the vehicle it
	 * outran. Its formation slot stays empty and reserved; an existing
	 * flanker keeps its original reservation, and an ambusher still has none.
	 */
	private flankVehicle(flanker: Vehicle, target: Vehicle | null): boolean {
		if (!target) {
			this.log('general', `${flanker.name} needs a vehicle to outrun`);
			return false;
		}
		const blocker = this.getFlankBlocker(flanker, target);
		const flankerTeam = this.getTeamForVehicle(flanker);
		if (blocker || !flankerTeam || !flanker.slot || !target.slot) {
			this.log('general', `Cannot flank: ${blocker}`, { vehicle: flanker.name, target: target.name });
			return false;
		}

		const destination = { lane: flankLane(flankerTeam.type), row: target.slot.row };
		const reservedSlot = flanker.flank ? flanker.flank.reservedSlot : flanker.slot;
		flanker.set({ slot: destination, flank: { reservedSlot, outran: target } });
		this.log('general',
			`${flanker.name} outruns ${target.name} and swerves onto ${describeSlot(destination)}`,
			{ vehicle: flanker.name, target: target.name }
		);
		return true;
	}

	/**
	 * Flankers that are no longer faster than the vehicle they outran swerve
	 * back to their reserved slot. Runs at the end of every turn. A flanker
	 * whose outran vehicle is out of the fight holds the shoulder, and so does
	 * an ambusher, which has no reserved slot to drop back to.
	 */
	private dropBackFlankers(): void {
		for (const vehicle of this.getAllVehicles()) {
			const reservedSlot = this.dropBackSlotOf(vehicle);
			const outran = vehicle.flank?.outran;
			if (!reservedSlot || !outran) continue;

			vehicle.set({ slot: reservedSlot, flank: null });
			this.log('general',
				`${vehicle.name} loses its speed edge on ${outran.name} and drops back to ${describeSlot(reservedSlot)}`,
				{ vehicle: vehicle.name, target: outran.name }
			);
		}
	}

	/**
	 * The reserved slot this flanker would drop back to if the turn ended
	 * now, or null if it holds where it is. Speed is the only test, so one
	 * flanker dropping back never changes another's answer.
	 */
	private dropBackSlotOf(vehicle: Vehicle): RoadSlot | null {
		const reservedSlot = vehicle.flank?.reservedSlot;
		const outran = vehicle.flank?.outran;
		if (!reservedSlot || !outran || vehicle.isOutOfFight || outran.isOutOfFight) return null;
		return vehicle.canFlank(outran) ? null : reservedSlot;
	}

	/**
	 * A wreck stays on the road for the rest of the turn it died in, holding
	 * its slot (or its shoulder slot and reservation, if it was flanking).
	 * At the end of that turn, yours or the enemy's, it leaves the road and
	 * its team. Its occupants already jumped out when it was wrecked.
	 *
	 * A raider with nobody alive aboard leaves the same way. A player's
	 * vehicle never does: it became an escort when its driver died.
	 */
	private clearWrecks(): void {
		for (const team of [this.playerTeam, this.enemyTeam]) {
			for (const vehicle of team.vehicles.filter(candidate => candidate.isOutOfFight)) {
				team.removeVehicle(vehicle);
				vehicle.set({ slot: null, flank: null });
				const reason = vehicle.isAlive() ? 'has nobody aboard' : 'is wrecked';
				this.log('general', `${vehicle.name} ${reason} and leaves the road`, { vehicle: vehicle.name });
			}
		}
	}

	private getAllVehicles(): Vehicle[] {
		return [...this.playerTeam.vehicles, ...this.enemyTeam.vehicles];
	}

	/**
	 * Whether an attack from one vehicle lands on another. The one hit rule:
	 * play and raider planning both call it. Each side's skills come from its
	 * vehicle (`Vehicle.crewSkills`): an escort's own, otherwise the caster's
	 * when attacking and the driver's when defending. A ram hits on ramming
	 * >= evade, anything else on gunnery > evade + modifier. A driven
	 * defender with nobody at the wheel has no skills and is never hit. A
	 * wrecked escort still has its profile, so callers skip wrecks first.
	 */
	public checkHit(options: {
		attacker: Vehicle | null;
		caster: Driver;
		defender: Vehicle;
		attackType?: string;
		modifier?: number;
	}): boolean {
		return this.hitCheck(options)?.hits ?? false;
	}

	/**
	 * checkHit's numbers, for the targeting preview: the skill it reads,
	 * both sides' values, and the outcome. Null when either side has nobody
	 * to act, which checkHit counts as a miss.
	 */
	public hitCheck({
		attacker,
		caster,
		defender,
		attackType = 'ranged',
		modifier = 0
	}: {
		attacker: Vehicle | null;
		caster: Driver;
		defender: Vehicle;
		attackType?: string;
		modifier?: number;
	}): HitCheck | null {
		const attack = attacker ? attacker.crewSkills(caster) : caster.skills;
		const defense = defender.crewSkills();
		if (!attack || !defense) {
			return null;
		}
		if (attackType === 'ramming') {
			return { skill: 'ramming', attack: attack.ramming, evade: defense.evade, modifier: 0, hits: attack.ramming >= defense.evade };
		}
		return { skill: 'gunnery', attack: attack.gunnery, evade: defense.evade, modifier, hits: attack.gunnery > defense.evade + modifier };
	}

	/**
	 * Calculate damage with modifiers
	 */
	public calculateDamage(baseDamage: number, attacker: Vehicle, target: Vehicle): number {
		return this.applyDamageModifiers(baseDamage, attacker.isFlanking, target);
	}

	/**
	 * Flanking and Vulnerable each add 50%. An area hit has no single target
	 * to be Vulnerable.
	 */
	private applyDamageModifiers(baseDamage: number, attackerFlanking: boolean, target: Vehicle | null): number {
		let damage = baseDamage;
		if (attackerFlanking) {
			damage = Math.floor(damage * 1.5);
		}
		if (target?.hasStatusEffect('vulnerable')) {
			damage = Math.floor(damage * 1.5);
		}
		return damage;
	}

	/**
	 * Formula damage on top of the effect's printed value: Ram's
	 * "armor/10 + (speed_diff)" on 0, Ramming Run's "speed_diff" on 4. Never
	 * below 0.
	 */
	public calculateFormulaDamage(formula: string, { base, armor, speedDiff }: { base: number; armor: number; speedDiff: number }): number {
		let damage = base;
		if (formula.includes('armor/10')) {
			damage += Math.floor(armor / 10);
		}
		if (formula.includes('armor/7')) {
			damage += Math.floor(armor / 7);
		}
		if (formula.includes('speed_diff * 2')) {
			damage += speedDiff * 2;
		} else if (formula.includes('speed_diff')) {
			damage += speedDiff;
		}
		return Math.max(0, damage);
	}

	/**
	 * Validate if a target is valid for a card
	 */
	private validateTarget(card: Card, caster: Driver, target: Vehicle | undefined): boolean {
		// Check if card needs a target
		if (card.targetType === 'self' || card.targetType === 'both_drivers' || card.targetType === 'enemy_all') {
			return true; // No external target needed
		}

		if (!target) {
			return false; // Card needs a target but none provided
		}

		const casterVehicle = this.getVehicleForDriver(caster);
		if (!casterVehicle) return false;

		const blocker = new BoardProjection({ battle: this }).targetBlocker({ card, caster: casterVehicle, target });
		if (blocker) {
			this.log('general', blocker);
			return false;
		}
		return true;
	}

	/**
	 * Get the vehicle that a driver is in
	 */
	public getVehicleForDriver(driver: Driver): Vehicle | null {
		return this.getAllVehicles().find(vehicle => vehicle.carries(driver)) ?? null;
	}

	/**
	 * Get the team that owns a driver
	 */
	private getTeamForDriver(driver: Driver): Team | null {
		if (this.playerTeam.getAllDrivers().includes(driver)) {
			return this.playerTeam;
		}
		if (this.enemyTeam.getAllDrivers().includes(driver)) {
			return this.enemyTeam;
		}
		return null;
	}
	
	/**
	 * Every living driver on both teams, the player's first
	 */
	private get livingDrivers(): Driver[] {
		return [...this.playerTeam.getAliveDrivers(), ...this.enemyTeam.getAliveDrivers()];
	}

	/**
	 * Shuffle every living driver's deck before the opening deal, so the
	 * order a deck was built in never fixes the fight's first hand. It draws
	 * from the seat's deck stream, the one its reshuffles carry on, so the
	 * fight's seed still fixes every shuffle.
	 */
	private shuffleOpeningDecks(): void {
		for (const driver of this.livingDrivers) {
			driver.deck?.shuffle(this.deckRngOf(driver));
		}
	}

	/**
	 * Draw the start-of-turn hand for every living driver on both teams
	 */
	private drawTurnHands(): void {
		for (const driver of this.livingDrivers) {
			this.logBurnedCards(driver, driver.drawCards(TURN_DRAW, this.deckRngOf(driver)));
		}
	}

	/**
	 * Resolve a card's draw effect for the driver who played it
	 */
	private drawForCard(card: Card, caster: Driver, count: number): void {
		const result = caster.drawCards(count, this.deckRngOf(caster));
		this.logAbout({
			type: 'general',
			driver: caster,
			say: (name) => `${card.displayName} draws ${count} cards for ${name}`,
			metadata: { card: card.displayName, driver: caster.metadata.name, value: count },
		});
		this.logBurnedCards(caster, result);
	}

	/**
	 * Tell the player which drawn cards went straight to discard because the hand was full
	 */
	private logBurnedCards(driver: Driver, { burned }: DrawResult): void {
		if (burned.length === 0) return;

		const cardNames = burned.map(card => card.displayName).join(', ');
		this.logAbout({
			type: 'cards_burned',
			driver,
			say: (name) => `${name}'s hand is full, so ${cardNames} ${burned.length === 1 ? 'goes' : 'go'} straight to the discard pile`,
			metadata: { driver: driver.metadata.name, value: burned.length },
		});
	}

	/**
	 * Driver name with their seat prefix (e.g., "Player1 Road Warrior")
	 */
	private getDriverDisplayName(driver: Driver): string {
		const seat = this.seatOf(driver);
		if (!seat) return driver.metadata.name;
		return `${seat.team === TeamType.PLAYER ? 'Player' : 'Enemy'}${seat.index + 1} ${driver.metadata.name}`;
	}

	/**
	 * A driver's seat: their team and their place in its seating order, which
	 * is where they started the fight, so it doesn't change when they ride on
	 * as a passenger or die. A driver seated later takes the next place on
	 * their team. Null for a driver on neither team.
	 */
	private seatOf(driver: Driver): { team: TeamType; index: number } | null {
		const seats = Battle.driverSeats.get(this);
		if (!seats) return null;

		for (const [team, drivers] of seats) {
			const index = drivers.indexOf(driver);
			if (index >= 0) return { team, index };
		}

		const team = this.getTeamForDriver(driver);
		const teamSeats = team && seats.get(team.type);
		if (!teamSeats) return null;
		teamSeats.push(driver);
		return this.seatOf(driver);
	}

	/**
	 * The stream a driver's deck shuffles from this fight, forked from the
	 * fight's by their seat, so it doesn't depend on who drew first. Named by
	 * the seat's team and index rather than the log's label for it, so a
	 * relabelled log can't move a fight's reshuffles.
	 */
	private deckRngOf(driver: Driver): Rng {
		const fight = Battle.fightRngs.get(this);
		const decks = Battle.deckRngs.get(this);
		if (!fight || !decks) throw new Error('Battle random streams not initialized');
		const known = decks.get(driver);
		if (known) return known;

		const seat = this.seatOf(driver);
		if (!seat) throw new Error(`${driver.metadata.name} draws in a fight they have no seat in`);
		const deck = fight.fork(`deck:${seat.team}:${seat.index}`);
		decks.set(driver, deck);
		return deck;
	}

	/**
	 * End the fight. Every driver who fought gets their exhausted cards back.
	 * Each convoy escort wrecked this fight is gone for the run, and the
	 * signature copy it brought leaves the decks now. Every living player
	 * vehicle leaves the road (Vehicle.leaveRoad). The convoy's escorts still
	 * running refill their armor, so they carry only their structure into the
	 * next fight; a driven vehicle keeps its damage, and one that carried on
	 * unmanned is still its driver's, not the convoy's. After a won fight the
	 * haulers among the convoy's escorts pay out. The Med Truck's heal lands
	 * here, on every driver who fought and is still alive, crashed out or
	 * not; fuel and scrap go in the result for the run's cargo. Runs once: a
	 * second call returns the same result.
	 */
	public endCombat(): AfterFight {
		const ended = Battle.afterFights.get(this);
		if (ended) return ended;

		const seats = Battle.driverSeats.get(this);
		// Exhaust is once per fight: every driver who fought gets theirs back
		for (const drivers of seats?.values() ?? []) {
			drivers.forEach(driver => driver.returnExhausted());
		}
		const playerDrivers = seats?.get(TeamType.PLAYER) ?? [];

		const convoyEscorts = Battle.convoyEscorts.get(this) ?? [];
		const lost = convoyEscorts.filter(escort => !escort.isAlive());
		for (const escort of lost) {
			const removed = playerDrivers.flatMap(driver => driver.removeCardsBroughtBy(escort.convoyId));
			const copies = removed.length > 0 ? `, and ${removed.map(card => card.name).join(', ')} leaves the deck` : '';
			this.log('general', `${escort.name} is lost for the run${copies}`, { vehicle: escort.name });
		}

		this.playerTeam.getAliveVehicles().forEach(vehicle => vehicle.leaveRoad());
		const escorts = convoyEscorts.filter(escort => escort.isAlive());
		escorts.forEach(escort => { escort.armor = escort.maxArmor; });

		const dividends: DividendPayout[] = !this.battleWon ? [] : escorts.flatMap(escort => {
			const dividend = escort.escort?.dividend;
			return dividend ? [{ escort, ...dividend }] : [];
		});
		for (const payout of dividends) {
			this.payDividend({ payout, drivers: playerDrivers });
		}

		const afterFight: AfterFight = { escorts, lost, dividends };
		Battle.afterFights.set(this, afterFight);
		this.emit('combatEnded', this.getState());
		return afterFight;
	}

	/**
	 * What the fight did to the convoy, or null while it's still on
	 */
	public get afterFight(): AfterFight | null {
		return Battle.afterFights.get(this) ?? null;
	}

	private payDividend({ payout, drivers }: { payout: DividendPayout; drivers: readonly Driver[] }): void {
		const { escort, kind, amount } = payout;
		if (kind !== 'heal') {
			this.log('general', `${escort.name} pays out ${amount} ${kind}`, { vehicle: escort.name, value: amount });
			return;
		}
		for (const driver of drivers.filter(candidate => candidate.isAlive())) {
			const before = driver.hitpoints;
			driver.heal(amount);
			const healed = driver.hitpoints - before;
			this.logAbout({
				type: 'heal_applied',
				driver,
				say: (name) => `${escort.name} patches up ${name}: +${healed} HP`,
				metadata: { vehicle: escort.name, driver: driver.metadata.name, value: healed },
			});
		}
	}

	/**
	 * Format a hand of cards with counts for duplicates
	 */
	private formatHandWithCounts(cards: Card[]): string {
		if (cards.length === 0) return 'No cards';
		
		// Count occurrences of each card
		const cardCounts = new Map<string, { card: Card, count: number }>();
		
		for (const card of cards) {
			const key = `${card.name}(${card.cost})`;
			const existing = cardCounts.get(key);
			if (existing) {
				existing.count++;
			} else {
				cardCounts.set(key, { card, count: 1 });
			}
		}
		
		// Format the output
		const formattedCards: string[] = [];
		for (const { card, count } of cardCounts.values()) {
			if (count > 1) {
				formattedCards.push(`${card.name} (${card.cost}) x${count}`);
			} else {
				formattedCards.push(`${card.name} (${card.cost})`);
			}
		}
		
		return formattedCards.join(', ');
	}

	/**
	 * Log the status of all vehicles and drivers
	 */
	private logTeamStatus(): void {
		// Log player team status
		this.log('debug', '=== PLAYER TEAM STATUS ===');
		this.playerTeam.vehicles.forEach((vehicle, index) => {
			const structureText = `${vehicle.structure}/${vehicle.maxStructure}`;
			const armorText = `${vehicle.armor}/${vehicle.maxArmor}`;
			let driverInfo = '';
			
			if (vehicle.driver) {
				driverInfo += ` | Driver: ${this.getDriverDisplayName(vehicle.driver)} (${vehicle.driver.hitpoints}/${vehicle.driver.maxHitpoints} HP)`;
			}
			if (vehicle.passenger) {
				driverInfo += ` | Passenger: ${this.getDriverDisplayName(vehicle.passenger)} (${vehicle.passenger.hitpoints}/${vehicle.passenger.maxHitpoints} HP)`;
			}
			
			this.log('debug',
				`  Vehicle ${index + 1}: Structure ${structureText}, Armor ${armorText}${driverInfo}`
			);
		});
		
		// Log enemy team status
		this.log('debug', '=== ENEMY TEAM STATUS ===');
		this.enemyTeam.vehicles.forEach((vehicle, index) => {
			const structureText = `${vehicle.structure}/${vehicle.maxStructure}`;
			const armorText = `${vehicle.armor}/${vehicle.maxArmor}`;
			let driverInfo = '';
			
			if (vehicle.driver) {
				driverInfo += ` | Driver: ${this.getDriverDisplayName(vehicle.driver)} (${vehicle.driver.hitpoints}/${vehicle.driver.maxHitpoints} HP)`;
			}
			if (vehicle.passenger) {
				driverInfo += ` | Passenger: ${this.getDriverDisplayName(vehicle.passenger)} (${vehicle.passenger.hitpoints}/${vehicle.passenger.maxHitpoints} HP)`;
			}
			
			this.log('debug',
				`  Vehicle ${index + 1}: Structure ${structureText}, Armor ${armorText}${driverInfo}`
			);
		});
	}

	/**
	 * Log all drivers' hands for debugging
	 */
	private logAllHands(): void {
		// Log player team hands
		this.log('debug', '=== PLAYER TEAM HANDS ===');
		this.playerTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('debug', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});
		
		// Log enemy team hands
		this.log('debug', '=== ENEMY TEAM HANDS ===');
		this.enemyTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('debug', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});
	}
}