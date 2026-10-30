import { isAtCompound } from '../../campaign/Campaign';
import type { Campaign } from '../../campaign/Campaign';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { RunDeck } from '../../campaign/RunDeck';
import { SeatBlocker, getCrewRule, getSeatBlocker } from '../../campaign/Seating';
import { seatableCrew } from '../../campaign/SupplyRun';
import { MAX_CONVOY_ESCORTS } from '../../mechanics/Team';
import type { Vehicle } from '../../mechanics/Vehicle';

/** Load out shows two seats; a solo run fills one (`getCrewRule`). */
export const SEAT_COUNT = 2;

/** Where a driver in the pool stands: in a seat, free to take the first free one, kept out by the rules, or waiting for a seat to clear. */
export type PoolStanding =
	| { kind: 'seated'; seat: number }
	| { kind: 'free' }
	| { kind: 'blocked'; blocker: SeatBlocker }
	| { kind: 'seats_full' };

/**
 * Why START RUN can't go yet: the campaign is over, nobody at the compound
 * is fit to go, fewer seats are filled than the crew rule asks for, or a
 * seated driver can't go.
 */
export type StartBlocker =
	| { reason: 'campaign_over' }
	| { reason: 'no_crew' }
	| { reason: 'seat_empty'; needed: number }
	| { reason: 'seat_blocked'; driver: DriverRecord; blocker: SeatBlocker };

/**
 * What load out has picked so far (Game Flow 1.2): the seats, the escorts
 * coming along, and whether the seats' run decks are out, kept apart from
 * the screen so the run deck lifecycle is plain to test.
 *
 * A run seats the crew `getCrewRule` allows: two drivers, or one when only
 * one is ready (gameplay call 35). It opens on the crew the quick load out
 * would send (`seatableCrew`) and the first `MAX_CONVOY_ESCORTS` escorts,
 * the most a run brings.
 *
 * The run decks start the first time they're needed (Customize, or START
 * RUN), with the seated crew and the escorts coming along. A seat that
 * changes after that unwinds them, and starts them again if the new crew
 * can go; an escort brought or left adds or removes its card in place, so
 * the seats' customizing survives it. `giveUp` unwinds them, so a run
 * started here is never left out when the player backs out.
 *
 * A run already out when the plan is made is taken as load out's own: its
 * seats are the run decks' drivers and its escorts are the ones whose
 * cards they hold. Only load out starts run decks, and the run route screen
 * opens it before departure, so a run out here is one load out started
 * before Customize.
 *
 * `changed` hears every change to the campaign, so the screen can save it.
 */
export class LoadOutPlan {
	public readonly campaign: Campaign;
	private readonly seated: (DriverRecord | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
	/** Convoy ids of the escorts left at home. */
	private readonly staying = new Set<string>();
	private readonly changed: () => void;

	constructor({ campaign, changed = () => undefined }: { campaign: Campaign; changed?: () => void }) {
		this.campaign = campaign;
		this.changed = changed;
		const decks = campaign.runDecks;
		if (decks.length > 0) {
			decks.slice(0, SEAT_COUNT).forEach((deck, seat) => { this.seated[seat] = deck.driver; });
			const brought = new Set(decks.flatMap((deck) => deck.escortCards.map((card) => card.broughtBy)));
			for (const escort of campaign.convoy.escorts) {
				if (escort.convoyId !== null && !brought.has(escort.convoyId)) this.staying.add(escort.convoyId);
			}
		} else {
			seatableCrew({ campaign })?.forEach((driver, seat) => { this.seated[seat] = driver; });
			for (const escort of campaign.convoy.escorts.slice(MAX_CONVOY_ESCORTS)) {
				if (escort.convoyId !== null) this.staying.add(escort.convoyId);
			}
		}
	}

	/** Each seat's driver, Driver 1 first, null for an empty seat. */
	public get seats(): readonly (DriverRecord | null)[] {
		return [...this.seated];
	}

	/** How many seats the run fills: one for a solo run, else two. */
	public get seatsNeeded(): number {
		return getCrewRule({ campaign: this.campaign }) === 'solo' ? 1 : SEAT_COUNT;
	}

	/** Whether the seats' run decks are out. */
	public get started(): boolean {
		return this.campaign.runDecks.length > 0;
	}

	/** Every driver at the compound, in pool order. */
	public get pool(): readonly DriverRecord[] {
		return this.campaign.drivers.filter((driver) => isAtCompound(driver));
	}

	/** The convoy's escorts coming along, in roster order. */
	public get escorts(): readonly Vehicle[] {
		return this.campaign.convoy.escorts.filter((escort) => !this.isStaying(escort));
	}

	public isStaying(escort: Vehicle): boolean {
		return escort.convoyId !== null && this.staying.has(escort.convoyId);
	}

	/** Whether an escort can be brought or left: one staying can come while fewer than `MAX_CONVOY_ESCORTS` are. */
	public canToggle(escort: Vehicle): boolean {
		if (escort.convoyId === null || this.campaign.isOver || !this.campaign.convoy.escorts.includes(escort)) return false;
		return !this.isStaying(escort) || this.escorts.length < MAX_CONVOY_ESCORTS;
	}

	/** A seat's run deck while the decks are out, else null. */
	public runDeckAt(seat: number): RunDeck | null {
		const driver = this.seated[seat];
		return driver ? this.campaign.runDeckOf(driver) : null;
	}

	/**
	 * Where a pool driver stands. Out of the seats, the rules ask of them
	 * alone and then beside each seated driver; with every seat the run
	 * fills taken and nothing against them, they wait for one to clear.
	 */
	public standing(driver: DriverRecord): PoolStanding {
		const seat = this.seated.indexOf(driver);
		if (seat >= 0) return { kind: 'seated', seat };
		const partners = this.crew;
		for (const partner of [null, ...partners]) {
			const blocker = getSeatBlocker({ campaign: this.campaign, driver, partner });
			if (blocker) return { kind: 'blocked', blocker };
		}
		return partners.length >= this.seatsNeeded ? { kind: 'seats_full' } : { kind: 'free' };
	}

	/** Seats a free driver in the first free seat. */
	public seat(driver: DriverRecord): void {
		if (this.standing(driver).kind !== 'free') return;
		const seat = this.seated.indexOf(null);
		this.reseat(() => { this.seated[seat] = driver; });
	}

	/** Empties a seat. */
	public clear(seat: number): void {
		if (!this.seated[seat] || this.campaign.isOver) return;
		this.reseat(() => { this.seated[seat] = null; });
	}

	/** Whether the seats can swap: both are filled. */
	public get canSwap(): boolean {
		return this.crew.length === SEAT_COUNT && !this.campaign.isOver;
	}

	/**
	 * Swaps the seats, so Driver 2 drives first. Run decks out are started
	 * again in the new order, the escorts' cards with the new Driver 1, and
	 * what was customized goes back to the default decks.
	 */
	public swap(): void {
		if (!this.canSwap) return;
		this.reseat(() => this.seated.reverse());
	}

	/** Brings an escort that was staying, or leaves one at home that was coming. */
	public toggleEscort(escort: Vehicle): void {
		const id = escort.convoyId;
		if (id === null || !this.canToggle(escort)) return;
		const bringing = this.staying.has(id);
		if (bringing) this.staying.delete(id);
		else this.staying.add(id);
		if (!this.started) return;
		if (bringing) this.campaign.addEscortCards({ escorts: [escort] });
		else this.campaign.removeEscortCards({ escorts: [escort] });
		this.changed();
	}

	/** Why START RUN can't go, or null when the seated crew can. */
	public get startBlocker(): StartBlocker | null {
		const { campaign } = this;
		if (campaign.isOver) return { reason: 'campaign_over' };
		if (getCrewRule({ campaign }) === 'none') return { reason: 'no_crew' };
		return this.crewBlocker();
	}

	/** Whether a seat's run deck can be customized: it's out already, or the seated crew can start. */
	public canCustomize(seat: number): boolean {
		return this.runDeckAt(seat) !== null || (this.seated[seat] !== null && this.startBlocker === null);
	}

	/** Starts the seats' run decks if they aren't out yet. Throws while START RUN can't go. */
	public start(): void {
		if (this.started) return;
		const blocker = this.startBlocker;
		if (blocker) throw new Error(`Load out can't start run decks: ${blocker.reason}`);
		this.startDecks();
		this.changed();
	}

	/** Backing out: unwinds the run decks if they're out. */
	public giveUp(): void {
		if (!this.started || this.campaign.isOver) return;
		this.campaign.unwindRunDecks();
		this.changed();
	}

	/** The seated drivers, Driver 1 first, skipping an empty seat. */
	private get crew(): DriverRecord[] {
		return this.seated.filter((driver): driver is DriverRecord => driver !== null);
	}

	/** A seat change: run decks out are unwound first, and started again once the new crew can go. */
	private reseat(change: () => void): void {
		const wasStarted = this.started;
		if (wasStarted) this.campaign.unwindRunDecks();
		change();
		if (wasStarted && this.crewBlocker() === null) this.startDecks();
		if (wasStarted) this.changed();
	}

	private startDecks(): void {
		this.campaign.startRunDecks({ seats: this.crew, escorts: this.escorts });
	}

	/** Why the seated crew can't go, as `startRunDecks` asks it: each seat alone, then together. */
	private crewBlocker(): StartBlocker | null {
		const needed = this.seatsNeeded;
		const crew = this.crew;
		if (crew.length < needed) return { reason: 'seat_empty', needed };
		const [first, second = null] = crew;
		const checks = [{ driver: first, partner: null }, ...(second ? [{ driver: second, partner: null }, { driver: first, partner: second }] : [])];
		for (const { driver, partner } of checks) {
			const blocker = getSeatBlocker({ campaign: this.campaign, driver, partner });
			if (blocker) return { reason: 'seat_blocked', driver, blocker };
		}
		return null;
	}
}
