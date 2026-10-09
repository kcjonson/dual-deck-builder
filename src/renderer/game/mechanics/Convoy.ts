import { Model } from '../core/Model';
import { Driver } from './Driver';
import { EscortDividend, EscortProfile } from './Escort';
import { MAX_CONVOY_ESCORTS } from './Team';
import { Vehicle } from './Vehicle';

/**
 * One hauler's after-fight payout
 */
export interface DividendPayout extends EscortDividend {
	escort: Vehicle;
}

/**
 * What a fight did to the convoy, from Battle.endCombat
 */
export interface AfterFight {
	/**
	 * The convoy's escorts still running at the end, in roster order, each
	 * off the road with its armor refilled. A driven vehicle that carried on
	 * unmanned isn't one, and neither is a set-piece ally: neither is the
	 * convoy's.
	 */
	escorts: Vehicle[];
	/** Convoy escorts wrecked this fight. The copies they brought have already left the decks. */
	lost: Vehicle[];
	/**
	 * What the surviving haulers paid, empty unless the fight was won. A heal
	 * has already landed on the drivers; fuel and scrap are the run's cargo.
	 */
	dividends: DividendPayout[];
}

export interface ConvoyData {
	escorts: readonly Vehicle[];
	/** The number in the next escort's id, `escort-<n>`. Saved, so no id is handed out twice. */
	nextEscortNumber: number;
}

const ESCORT_ID = /^escort-([1-9][0-9]*)$/;

/** The number in an escort's id, `escort-<n>`, or null for anything else. */
export function escortNumber(id: string): number | null {
	const match = ESCORT_ID.exec(id);
	return match ? Number(match[1]) : null;
}

/** Convoys partway through giving a joining escort its id. Model instances are frozen, so this can't be a field. */
const joining = new WeakSet<Convoy>();

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Convoy extends Readonly<ConvoyData> {}

/**
 * The escorts you own, in roster order (first acquired first), between
 * fights. A player team fields them in this order. Up to four, each of a
 * hired type.
 *
 * An escort gets its id, `escort-<n>`, when it joins, from a counter the
 * convoy saves and never turns back, so no two escorts a campaign ever
 * owns share one. It keeps the id for good, and joins a convoy only once.
 * `add` is the only way in: `set` only takes escorts out, in roster order.
 */
export class Convoy extends Model<ConvoyData> {
	static properties = new Set<keyof ConvoyData>([
		'escorts',
		'nextEscortNumber'
	]);

	/**
	 * Escorts with an id (a loaded convoy's) keep it, and must be below the
	 * counter, which is one past the highest of them when left out. Escorts
	 * that haven't joined a convoy join this one, in roster order, as `add`
	 * would have them.
	 */
	constructor({ escorts = [], nextEscortNumber }: { escorts?: readonly Vehicle[]; nextEscortNumber?: number } = {}) {
		escorts.forEach(Convoy.assertConvoyEscort);
		if (escorts.length > MAX_CONVOY_ESCORTS) {
			throw new Error(`A convoy holds ${MAX_CONVOY_ESCORTS} escorts at most, not ${escorts.length}`);
		}
		const counter = nextEscortNumber ?? firstFreeEscortNumber(escorts);
		assertEscortIds({ escorts, nextEscortNumber: counter });
		let next = counter;
		escorts.forEach(escort => {
			if (escort.convoyId === null) giveId({ escort, id: `escort-${next++}` });
		});
		super({ escorts: Object.freeze([...escorts]), nextEscortNumber: next });
	}

	private static assertConvoyEscort(vehicle: Vehicle): void {
		if (!vehicle.isEscort) {
			throw new Error(`${vehicle.name} is not an escort`);
		}
		if (vehicle.escort?.setPiece) {
			throw new Error(`${vehicle.name} is a set-piece ally, not the convoy's`);
		}
		if (vehicle.escort?.type == null) {
			throw new Error(`${vehicle.name} isn't of a hired type: a vehicle carrying on unmanned is its driver's, not the convoy's`);
		}
	}

	/**
	 * Changes fields as Model.set does, but throws, changing nothing, if an
	 * escort would join (`add` is the way in, with an id), escorts would
	 * change places or be listed twice, or the counter would go back and hand
	 * out an id again or stop being a whole number from 1. Nothing changes
	 * while an escort is being given its id.
	 */
	public override set(changes: Partial<ConvoyData>): void {
		// Model's constructor sets the first state, which the convoy's constructor has checked
		const constructing = this.escorts === undefined;
		if (joining.has(this)) throw new Error("The convoy can't change while an escort is joining it");
		const counter = changes.nextEscortNumber;
		if (counter !== undefined) {
			assertCounter(counter);
			if (!constructing && counter < this.nextEscortNumber) {
				throw new RangeError(`Convoy.nextEscortNumber can't go back, from ${this.nextEscortNumber} to ${counter}`);
			}
		}
		if (changes.escorts !== undefined && !constructing) assertOnlyLeaving({ before: this.escorts, after: changes.escorts });
		super.set(changes.escorts === undefined ? changes : { ...changes, escorts: Object.freeze([...changes.escorts]) });
	}

	/**
	 * At four, taking another means dismissing one first
	 */
	public get isFull(): boolean {
		return this.escorts.length >= MAX_CONVOY_ESCORTS;
	}

	/**
	 * A newly acquired escort joins the end of the roster, with the next id.
	 * The escort's listeners hear the id before it's in the convoy, so the
	 * convoy refuses every change, another add included, until it's in;
	 * the convoy's own listeners hear it once it's whole.
	 */
	public add(escort: Vehicle): void {
		if (joining.has(this)) throw new Error(`Can't add ${escort.name} while another escort is joining the convoy`);
		Convoy.assertConvoyEscort(escort);
		if (this.escorts.includes(escort)) {
			throw new Error(`${escort.name} is already in the convoy`);
		}
		const held = escort.convoyId;
		if (held !== null) {
			throw new Error(`${escort.name} (${held}) has joined a convoy before, and an escort joins only once`);
		}
		if (this.isFull) {
			throw new Error(`The convoy holds ${MAX_CONVOY_ESCORTS} escorts; dismiss one first`);
		}
		const number = this.nextEscortNumber;
		joining.add(this);
		try {
			giveId({ escort, id: `escort-${number}` });
		} finally {
			joining.delete(this);
		}
		super.set({ escorts: Object.freeze([...this.escorts, escort]), nextEscortNumber: number + 1 });
	}

	/**
	 * Let an escort go, and the signature copy it brought with it, from
	 * whichever of these drivers holds it
	 */
	public dismiss({ escort, drivers }: { escort: Vehicle; drivers: readonly Driver[] }): void {
		if (!this.escorts.includes(escort)) {
			throw new Error(`${escort.name} is not in the convoy`);
		}
		this.set({ escorts: this.escorts.filter(owned => owned !== escort) });
		drivers.forEach(driver => driver.removeCardsBroughtBy(escort.convoyId));
	}

	/**
	 * The lost are gone for good: wrecked in a fight (`AfterFight.lost`), or
	 * with a run that failed. Nothing joins after a fight.
	 */
	public afterFight({ lost }: { lost: readonly Vehicle[] }): void {
		this.set({ escorts: this.escorts.filter(owned => !lost.includes(owned)) });
	}
}

function giveId({ escort, id }: { escort: Vehicle; id: string }): void {
	escort.set({ escort: { ...(escort.escort as EscortProfile), id } });
}

function assertCounter(nextEscortNumber: number): void {
	if (!Number.isInteger(nextEscortNumber) || nextEscortNumber < 1) {
		throw new RangeError(`Convoy.nextEscortNumber must be an integer >= 1, got ${nextEscortNumber}`);
	}
}

/** A change to the roster only takes escorts out, keeping the rest in the order they joined. */
function assertOnlyLeaving({ before, after }: { before: readonly Vehicle[]; after: readonly Vehicle[] }): void {
	let from = 0;
	for (const escort of after) {
		const at = before.indexOf(escort, from);
		if (at === -1) {
			throw new Error(before.includes(escort)
				? `${escort.name} would change places in the roster or be listed twice; escorts keep the order they joined in`
				: `${escort.name} isn't in the convoy, and an escort joins through add`);
		}
		from = at + 1;
	}
}

/** Ids already given out are well formed, each held once, and below the counter; no escort is listed twice. */
function assertEscortIds({ escorts, nextEscortNumber }: { escorts: readonly Vehicle[]; nextEscortNumber: number }): void {
	assertCounter(nextEscortNumber);
	const ids = new Set<string>();
	escorts.forEach((escort, index) => {
		if (escorts.indexOf(escort) !== index) throw new Error(`${escort.name} is in the convoy twice`);
		const id = escort.convoyId;
		if (id === null) return;
		const number = escortNumber(id);
		if (number === null) throw new RangeError(`${escort.name}'s id must look like escort-1, got ${JSON.stringify(id)}`);
		if (number >= nextEscortNumber) {
			throw new RangeError(`${escort.name}'s id must come before escort-${nextEscortNumber}, the next id to hand out, got ${id}`);
		}
		if (ids.has(id)) throw new RangeError(`${escort.name}'s id ${id} belongs to an earlier escort`);
		ids.add(id);
	});
}

/** One past the highest `escort-<n>` among these, for a convoy built without a counter. */
function firstFreeEscortNumber(escorts: readonly Vehicle[]): number {
	return escorts.reduce((highest, escort) => Math.max(highest, escortNumber(escort.convoyId ?? '') ?? 0), 0) + 1;
}
