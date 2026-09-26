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
	openingSlots,
	resolveFormationSlot,
	sameSlot,
	slotRange
} from './Road';
import { Card, CardEffect } from './Card';
import { BoardProjection, cardRange } from './BoardProjection';
import { ESCORT_CONFIGS } from './Escort';
import { EffectRecipient, effectRecipientOf, effectRecipients, isCasterAction, rollsToHit } from './EffectTargets';
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
	| 'general';

/**
 * Battle log message
 */
export interface BattleMessage {
	type: BattleMessageType;
	message: string;
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
 * A vehicle's driver and its living occupants, taken before a hit
 */
interface Crew {
	driver: Driver | null;
	living: Driver[];
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

	// Each team's drivers in the order they were first seated, so a driver's
	// log name (Player1, Enemy2) survives a wreck or a death
	private static driverSeats = new WeakMap<Battle, Map<TeamType, Driver[]>>();

	// Escorts under Draw Fire, in the order it was played, until the end of
	// the next enemy turn (stored separately due to Model freezing)
	private static drawFireCovers = new WeakMap<Battle, Vehicle[]>();

	// Static flag to control console logging
	public static suppressConsoleLog = false;

	/**
	 * Create a new battle
	 */
	constructor({
		playerTeam,
		enemyTeam,
		maxTurns
	}: {
		playerTeam: Team;
		enemyTeam: Team;
		maxTurns?: number;
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

		// Initialize AI controller (stored in WeakMap to avoid Model freezing issues)
		Battle.aiControllers.set(this, new AIController(this));
		
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
	 * ambusher, checked once the formations are down since it needs an
	 * opposing vehicle in its row.
	 */
	private placeOpeningFormation(): void {
		const teams = [this.playerTeam, this.enemyTeam];
		const placed: Vehicle[] = [];
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
				if (placed.some(other => sameSlot(other.slot, slot))) {
					throw new Error(`Two vehicles start in ${describeSlot(slot)}`);
				}
				vehicle.flank = null;
				placed.push(vehicle);
				if (ambush) ambushers.push({ vehicle, teamType: team.type, slot });
			}
		}

		for (const team of teams) {
			const freeSlots = openingSlots(team.type).filter(slot => !placed.some(v => sameSlot(v.slot, slot)));
			const unplaced = team.vehicles.filter(vehicle => !vehicle.slot);
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
				vehicle.set({ slot, flank: null });
				placed.push(vehicle);
			}
		}

		for (const ambusher of ambushers) {
			const blocker = this.getAmbushBlocker(ambusher);
			if (blocker) {
				throw new Error(blocker);
			}
			ambusher.vehicle.flank = { reservedSlot: null, outran: null };
		}
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
			(sameSlot(other.slot, slot) || sameSlot(other.flank?.reservedSlot ?? null, slot)));
		if (taken) {
			return `${describeSlot(slot)} is taken`;
		}
		const opposingTeam = teamType === TeamType.PLAYER ? this.enemyTeam : this.playerTeam;
		const hasOpponentInRow = opposingTeam.vehicles.some(other => !other.isOutOfFight && other.slot?.row === slot.row);
		if (!hasOpponentInRow) {
			return `${vehicle.name} can't ambush in the ${slot.row} row; no ${opposingTeam.type} vehicle is in it`;
		}
		return null;
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
	 * Log a battle message
	 */
	private log(type: BattleMessageType, message: string, metadata?: BattleMessage['metadata']): void {
		const messageLog = Battle.messageLogs.get(this);
		if (!messageLog) {
			throw new Error('Message log not initialized');
		}

		const logEntry: BattleMessage = {
			type,
			message,
			timestamp: Date.now(),
			turn: this.turn,
			metadata
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

		this.drawTurnHands();

		// Refill adrenaline for all drivers
		this.playerTeam.refillAdrenaline();
		this.enemyTeam.refillAdrenaline();

		this.playerTeam.readyEscorts();

		this.planEnemyTurn();

		this.log('battle_start', 'Battle started!');
		
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
			this.log('general', 'Driver does not belong to player team');
			return false;
		}

		const card = driver.hand[cardIndex];
		const cardBlocker = this.getCardBlocker({ driver, card });
		if (cardBlocker) {
			this.log('general', `Cannot play card: ${cardBlocker}`);
			return false;
		}
		if (!this.validateTarget(card, driver, targetVehicle)) {
			this.log('general', `Invalid target for card "${card.name}" (type: ${card.targetType}). Driver: ${this.getDriverDisplayName(driver)}, Target: ${targetVehicle ? targetVehicle.name : 'undefined'}`);
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
		this.log('card_played', 
			`${this.getDriverDisplayName(driver)} plays ${card.displayName} (Adrenaline: ${adrenalineBefore} -> ${driver.adrenaline})`,
			{ driver: driver.metadata.name, card: card.displayName, adrenalineBefore, adrenalineAfter: driver.adrenaline }
		);

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
	 * End the player's turn
	 */
	public async endPlayerTurn(): Promise<void> {
		if (!this.isPlayerTurn || this.battleOver) {
			return;
		}

		// Log player hands before discarding
		this.log('general', '=== PLAYER FINAL HANDS ===');
		this.playerTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
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

		this.processEnemyTurns();
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
	 * What the player sees of a raider's plan. Values are worked out now, so
	 * a Vulnerable the player picks up this turn shows in the number. Elites
	 * and bosses hide the value and the card.
	 */
	public getIntents(raider: Vehicle): Intent[] {
		const hidden = (raider.intentTier ?? IntentTier.BASIC) !== IntentTier.BASIC;
		return this.getPlan(raider).map(action => {
			const type = intentTypeOf(action.card);
			const target = this.plannedTarget(raider, action);
			let amount: number | null = null;
			let label: string | null = null;
			if (type === IntentType.ATTACK) {
				amount = this.previewDamage(raider, action, target);
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
		});
	}

	/**
	 * Where a planned card is headed as the board stands: its planned
	 * target, or the escort drawing fire in that target's row if the card
	 * could reach it from where the raider will be. This is what the target
	 * marks and the end-turn preview show.
	 */
	private plannedTarget(raider: Vehicle, action: PlannedAction): Vehicle | null {
		if (!action.target) return null;
		return this.drawFireRedirect({ raider, card: action.card, target: action.target, raiderSlot: action.slot }) ?? action.target;
	}

	/**
	 * The escort under Draw Fire that takes this card instead of its target,
	 * or null. Draw Fire covers single-target cards that land something on a
	 * driven vehicle in the escort's row; an area hit keeps its targets
	 * (DDB-150), and so does a card with nothing landing on its target (a
	 * flank). Rows are judged as they stand, and the last Draw Fire played
	 * on the row wins. It never cancels: a card that can't reach the escort
	 * keeps its target.
	 */
	private drawFireRedirect({
		raider,
		card,
		target,
		raiderSlot
	}: {
		raider: Vehicle;
		card: Card;
		target: Vehicle;
		raiderSlot: RoadSlot | null;
	}): Vehicle | null {
		const covers = Battle.drawFireCovers.get(this) ?? [];
		const row = target.slot?.row;
		if (covers.length === 0 || !row || card.targetType === 'enemy_all' || target.isEscort || !this.playerTeam.vehicles.includes(target)) {
			return null;
		}
		const landsOnTarget = card.effects.some(effect => !isCasterAction(effect) && effectRecipientOf({ effect, card }) === EffectRecipient.TARGET);
		if (!landsOnTarget) return null;

		// The last living cover on the row: a wrecked one hides nothing, and
		// after clearWrecks it has no slot, so preview and play agree
		const escort = [...covers].reverse().find(cover =>
			!cover.isOutOfFight && cover.slot?.row === row && this.playerTeam.vehicles.includes(cover));
		if (!escort) return null;
		return this.getPlannedCardBlocker(card, raider, escort, raiderSlot) === null ? escort : null;
	}

	/**
	 * Damage per hit a planned attack deals if it lands, from the raider's
	 * projected flank state and speed and the target as it is now.
	 */
	private previewDamage(raider: Vehicle, action: PlannedAction, target: Vehicle | null): number {
		const effect = attackEffectOf(action.card);
		if (!effect) return 0;
		let damage = typeof effect.value === 'number' ? effect.value : 0;
		if (effect.formula && typeof effect.formula === 'string' && target) {
			damage = this.calculateFormulaDamage(effect.formula, {
				base: damage,
				armor: raider.armor,
				speedDiff: action.speed - target.speed
			});
		}
		return this.applyDamageModifiers(damage, action.flanking, target);
	}

	/**
	 * Play each raider's plan, one raider at a time.
	 */
	private processEnemyTurns(): void {
		if (this.battleOver) {
			return;
		}

		const plans = Battle.enemyPlans.get(this) ?? new Map<Vehicle, PlannedAction[]>();
		Battle.enemyPlans.delete(this);

		for (const [raider, actions] of plans) {
			for (const action of actions) {
				if (!raider.isAlive()) {
					this.log('general', `${raider.name} is wrecked and drops its plan`, { vehicle: raider.name });
					break;
				}
				if (!action.driver.isAlive() || raider.driver !== action.driver) {
					this.log('general', `${raider.name} lost its driver and drops its plan`, { vehicle: raider.name });
					break;
				}

				this.playPlannedAction(raider, action);

				this.checkBattleStatus();
				if (this.battleOver) {
					return;
				}
			}
		}

		// Log enemy hands before ending turn
		this.log('general', '=== ENEMY FINAL HANDS ===');
		this.enemyTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
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
	private playPlannedAction(raider: Vehicle, action: PlannedAction): void {
		const { card, driver } = action;
		const adrenalineBefore = driver.adrenaline;
		const result = driver.playCardWithCost(driver.hand.indexOf(card));
		if (!result.success) {
			this.log('general', `${raider.name} can't play ${card.displayName}: ${result.reason}`, { vehicle: raider.name, card: card.displayName });
			return;
		}

		this.log('card_played',
			`${this.getDriverDisplayName(driver)} plays ${card.displayName} (Adrenaline: ${adrenalineBefore} -> ${driver.adrenaline})`,
			{ driver: driver.metadata.name, card: card.displayName, adrenalineBefore, adrenalineAfter: driver.adrenaline }
		);

		if (card.targetType === 'enemy_all' || !action.target) {
			this.applyCardEffects({ card, caster: driver, target: null });
			return;
		}

		let target: Vehicle | null = action.target;
		if (!target.isAlive()) {
			const wreck: Vehicle = target;
			const survivors = Team.survivorsOf(wreck);
			target = this.findVehicleCarrying(survivors);
			if (!target) {
				const why = survivors.length === 0 ? 'nobody got out' : 'nobody who got out is still in the fight';
				this.log('fizzle', `${raider.name}'s ${card.displayName} fizzles: ${wreck.name} is wrecked and ${why}`,
					{ vehicle: raider.name, card: card.displayName, target: wreck.name });
				return;
			}
			this.log('general', `${wreck.name} is wrecked, so ${raider.name} turns ${card.displayName} on ${target.name}`,
				{ vehicle: raider.name, card: card.displayName, target: target.name });
		}
		if (target.isUnmanned()) {
			this.log('fizzle', `${raider.name}'s ${card.displayName} fizzles: ${target.name} has nobody aboard`,
				{ vehicle: raider.name, card: card.displayName, target: target.name });
			return;
		}

		const cover = this.drawFireRedirect({ raider, card, target, raiderSlot: raider.slot });
		if (cover) {
			this.log('general', `${cover.name} draws ${raider.name}'s ${card.displayName} away from ${target.name}`,
				{ vehicle: raider.name, card: card.displayName, target: cover.name });
			target = cover;
		}

		const reason = this.getPlannedCardBlocker(card, raider, target);
		if (reason) {
			this.log('fizzle', `${raider.name}'s ${card.displayName} fizzles: ${reason}`,
				{ vehicle: raider.name, card: card.displayName, target: target.name });
			return;
		}

		this.applyCardEffects({ card, caster: driver, target });
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
	 * the log, or null if it still can. Range is measured from the caster's
	 * slot unless another is given (where a plan puts it).
	 */
	private getPlannedCardBlocker(card: Card, caster: Vehicle, target: Vehicle, casterSlot: RoadSlot | null = caster.slot): string | null {
		if (target.isOutOfFight) {
			return `${target.name} is out of the fight`;
		}
		for (const effect of card.effects) {
			if (typeof effect.range === 'number') {
				if (!casterSlot || !target.slot) {
					return `${target.name} is not on the road`;
				}
				const range = slotRange(casterSlot, target.slot);
				if (range > effect.range) {
					return `${target.name} is out of range (${range} away, needs ${effect.range})`;
				}
			}
			if (effect.condition === 'target_flanking' && !target.isFlanking) {
				return `${target.name} is no longer flanking`;
			}
		}
		if (!this.meetsFlankRules(card, caster, target)) {
			return this.getFlankBlocker(caster, target);
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
				this.log('general',
					`${card.displayName} gives ${afterAdrenaline - beforeAdrenaline} adrenaline to ${caster.metadata.name} (Adrenaline: ${beforeAdrenaline}/${maxAdrenaline} -> ${afterAdrenaline}/${maxAdrenaline})`,
					{ card: card.displayName, driver: caster.metadata.name, value: adrenalineValue }
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
				this.log('heal_applied',
					`${card.displayName} repairs ${structureHealed} structure and ${armorHealed} armor on ${recipient.name} (Structure: ${structureText}, Armor: ${armorText})`,
					{ card: card.displayName, target: recipient.name, value: healValue }
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
				this.log('heal_applied',
					`${card.displayName} heals ${afterHP - beforeHP} hit points on ${this.getDriverDisplayName(patient)} (HP: ${beforeHP}/${maxHP} -> ${afterHP}/${maxHP})`,
					{ card: card.displayName, target: patient.metadata.name, value: healValue }
				);
				break;
			}

			case 'armor':
			case 'gain_armor': {
				const armorValue = typeof effect.value === 'number' ? effect.value : 0;
				const beforeArmor = recipient.armor;

				recipient.addArmor(armorValue);

				const armorText = `${beforeArmor}/${recipient.maxArmor} -> ${recipient.armor}/${recipient.maxArmor}`;
				this.log('armor_gained',
					`${card.displayName} adds ${recipient.armor - beforeArmor} armor to ${recipient.name} (Armor: ${armorText})`,
					{ card: card.displayName, target: recipient.name, value: armorValue }
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
				this.log('general',
					`${card.displayName} gives ${fueled.adrenaline - before} adrenaline to ${this.getDriverDisplayName(fueled)} (Adrenaline: ${before}/${fueled.maxAdrenaline} -> ${fueled.adrenaline}/${fueled.maxAdrenaline})`,
					{ card: card.displayName, driver: fueled.metadata.name, value: effect.value }
				);
				break;
			}

			case 'draw_fire': {
				// Last one played wins its row, so a repeat moves to the end
				const covers = (Battle.drawFireCovers.get(this) ?? []).filter(cover => cover !== recipient);
				Battle.drawFireCovers.set(this, [...covers, recipient]);
				this.log('status_applied',
					`${recipient.name} draws fire: until the end of the next enemy turn, raider cards aimed at driven vehicles in its row turn on it if they can reach it`,
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
			this.getTeamForVehicle(recipient)?.handleVehicleDestruction(recipient);
		}
		return true;
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

		let logMessage = `${card.displayName} applies ${statusName} to ${recipient.name}`;
		if (SPEED_STATUSES.includes(statusName)) {
			logMessage += ` (Speed: ${speedBefore} -> ${recipient.speed})`;
		}
		this.log('status_applied',
			logMessage,
			{ card: card.displayName, target: recipient.name, status: statusName }
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
	 * Damage through armor into structure and whoever is aboard, logged with
	 * where it went
	 */
	private damageVehicle({ vehicle, damage, card, structureOnly = false }: { vehicle: Vehicle; damage: number; card: Card; structureOnly?: boolean }): void {
		const beforeStructure = vehicle.structure;
		const beforeArmor = vehicle.armor;
		const crew = this.crewOf(vehicle);
		const crewHealth = (): number => crew.living.reduce((sum, occupant) => sum + occupant.hitpoints, 0);
		const beforeCrewHealth = crewHealth();

		if (structureOnly) {
			vehicle.damageStructure(damage);
		} else {
			vehicle.takeDamage(damage);
		}

		const split = [
			[beforeArmor - vehicle.armor, 'armor'],
			[beforeStructure - vehicle.structure, 'structure'],
			[beforeCrewHealth - crewHealth(), 'occupants']
		] as const;
		const landed = split.filter(([amount]) => amount > 0).map(([amount, where]) => `${amount} to ${where}`);
		const breakdown = landed.length > 0 ? `${damage} total (${landed.join(', ')})` : `${damage} total`;
		const structureText = `${beforeStructure}/${vehicle.maxStructure} -> ${vehicle.structure}/${vehicle.maxStructure}`;
		const armorText = `${beforeArmor}/${vehicle.maxArmor} -> ${vehicle.armor}/${vehicle.maxArmor}`;

		this.log('damage_dealt',
			`${card.displayName} deals ${breakdown} damage to ${vehicle.name} (Structure: ${structureText}, Armor: ${armorText})`,
			{ card: card.displayName, target: vehicle.name, value: damage }
		);
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
		this.log('damage_dealt',
			`${card.displayName} deals ${damage} damage to ${this.getDriverDisplayName(driver)}`,
			{ card: card.displayName, target: driver.metadata.name, value: damage }
		);
		if (vehicle && crew) {
			vehicle.handleDriverDeath();
			this.logDeaths(vehicle, crew);
		}
	}

	/**
	 * Log who a hit killed and who has the wheel now. The vehicle has already
	 * taken the dead out of their seats. A wreck's survivors are logged by
	 * where they jump, not here.
	 */
	private logDeaths(vehicle: Vehicle, crew: Crew): void {
		for (const occupant of crew.living) {
			if (!occupant.isAlive()) {
				this.log('general', `${this.getDriverDisplayName(occupant)} is dead`, { driver: occupant.metadata.name });
			}
		}
		if (!vehicle.isAlive() || vehicle.driver === crew.driver) {
			return;
		}
		if (vehicle.driver) {
			this.log('general', `${this.getDriverDisplayName(vehicle.driver)} takes the wheel of ${vehicle.name}`,
				{ driver: vehicle.driver.metadata.name, vehicle: vehicle.name });
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
			const reservedSlot = vehicle.flank?.reservedSlot;
			const outran = vehicle.flank?.outran;
			if (!reservedSlot || !outran || vehicle.isOutOfFight || outran.isOutOfFight) continue;
			if (vehicle.canFlank(outran)) continue;

			vehicle.set({ slot: reservedSlot, flank: null });
			this.log('general',
				`${vehicle.name} loses its speed edge on ${outran.name} and drops back to ${describeSlot(reservedSlot)}`,
				{ vehicle: vehicle.name, target: outran.name }
			);
		}
	}

	/**
	 * A wreck stays on the road for the rest of the turn it died in, holding
	 * its slot (or its shoulder slot and reservation, if it was flanking).
	 * At the end of that turn, yours or the enemy's, it leaves the road and
	 * its team. Its occupants already jumped out when it was wrecked.
	 *
	 * A vehicle with nobody alive aboard leaves the same way. The spec has a
	 * raider do this; a player vehicle should become an escort instead, which
	 * waits on DDB-152, so for now it leaves too.
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

	/**
	 * A flank card needs a target this vehicle can flank; other cards pass.
	 */
	private meetsFlankRules(card: Card, casterVehicle: Vehicle, target: Vehicle): boolean {
		const flanks = card.effects.some(e => e.type === 'change_position' && e.position === 'flanking');
		return !flanks || this.canFlank(casterVehicle, target);
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
	public checkHit({
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
	}): boolean {
		const attack = attacker ? attacker.crewSkills(caster) : caster.skills;
		const defense = defender.crewSkills();
		if (!attack || !defense) {
			return false;
		}
		if (attackType === 'ramming') {
			return attack.ramming >= defense.evade;
		}
		return attack.gunnery > defense.evade + modifier;
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
	private calculateFormulaDamage(formula: string, { base, armor, speedDiff }: { base: number; armor: number; speedDiff: number }): number {
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
	private getVehicleForDriver(driver: Driver): Vehicle | null {
		return this.getAllVehicles().find(v => v.driver === driver || v.passenger === driver) || null;
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
	 * Draw the start-of-turn hand for every living driver on both teams
	 */
	private drawTurnHands(): void {
		for (const driver of [...this.playerTeam.getAliveDrivers(), ...this.enemyTeam.getAliveDrivers()]) {
			this.logBurnedCards(driver, driver.drawCards(TURN_DRAW));
		}
	}

	/**
	 * Resolve a card's draw effect for the driver who played it
	 */
	private drawForCard(card: Card, caster: Driver, count: number): void {
		const result = caster.drawCards(count);
		this.log('general',
			`${card.displayName} draws ${count} cards for ${this.getDriverDisplayName(caster)}`,
			{ card: card.displayName, driver: caster.metadata.name, value: count }
		);
		this.logBurnedCards(caster, result);
	}

	/**
	 * Tell the player which drawn cards went straight to discard because the hand was full
	 */
	private logBurnedCards(driver: Driver, { burned }: DrawResult): void {
		if (burned.length === 0) return;

		const cardNames = burned.map(card => card.displayName).join(', ');
		this.log('cards_burned',
			`${this.getDriverDisplayName(driver)}'s hand is full, so ${cardNames} ${burned.length === 1 ? 'goes' : 'go'} straight to the discard pile`,
			{ driver: driver.metadata.name, value: burned.length }
		);
	}

	/**
	 * Driver name with their seat prefix (e.g., "Player1 Road Warrior"). The
	 * seat is where they started the fight, so it doesn't change when they
	 * ride on as a passenger or die. A driver seated later takes the next
	 * number on their team.
	 */
	private getDriverDisplayName(driver: Driver): string {
		const seats = Battle.driverSeats.get(this);
		if (!seats) return driver.metadata.name;

		for (const [teamType, drivers] of seats) {
			const seat = drivers.indexOf(driver) + 1;
			if (seat > 0) {
				return `${teamType === TeamType.PLAYER ? 'Player' : 'Enemy'}${seat} ${driver.metadata.name}`;
			}
		}

		const team = this.getTeamForDriver(driver);
		const teamSeats = team && seats.get(team.type);
		if (!teamSeats) return driver.metadata.name;
		teamSeats.push(driver);
		return this.getDriverDisplayName(driver);
	}

	/**
	 * End combat and process post-combat effects
	 */
	public endCombat(): void {
		// Exhaust is once per fight: every driver who fought gets theirs back
		for (const drivers of Battle.driverSeats.get(this)?.values() ?? []) {
			drivers.forEach(driver => driver.returnExhausted());
		}
		this.emit('combatEnded', this.getState());
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
		this.log('general', '=== PLAYER TEAM STATUS ===');
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
			
			this.log('general', 
				`  Vehicle ${index + 1}: Structure ${structureText}, Armor ${armorText}${driverInfo}`
			);
		});
		
		// Log enemy team status
		this.log('general', '=== ENEMY TEAM STATUS ===');
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
			
			this.log('general', 
				`  Vehicle ${index + 1}: Structure ${structureText}, Armor ${armorText}${driverInfo}`
			);
		});
	}

	/**
	 * Log all drivers' hands for debugging
	 */
	private logAllHands(): void {
		// Log player team hands
		this.log('general', '=== PLAYER TEAM HANDS ===');
		this.playerTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});
		
		// Log enemy team hands
		this.log('general', '=== ENEMY TEAM HANDS ===');
		this.enemyTeam.getAllDrivers().forEach(driver => {
			if (driver.isAlive()) {
				const handCards = this.formatHandWithCounts(driver.hand);
				this.log('general', `  ${this.getDriverDisplayName(driver)}: ${handCards}`);
			}
		});
	}
}