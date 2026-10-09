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
	escorts: Vehicle[];
	/** The number in the next escort's id, `escort-<n>`. Saved, so no id is handed out twice. */
	nextEscortNumber: number;
}

const ESCORT_ID = /^escort-([1-9][0-9]*)$/;

/** The number in an escort's id, `escort-<n>`, or null for anything else. */
export function escortNumber(id: string): number | null {
	const match = ESCORT_ID.exec(id);
	return match ? Number(match[1]) : null;
}

/** The counter is read-only from outside: only joining moves it. */
export interface Convoy extends Omit<ConvoyData, 'nextEscortNumber'>, Readonly<Pick<ConvoyData, 'nextEscortNumber'>> {}

/**
 * The escorts you own, in roster order (first acquired first), between
 * fights. A player team fields them in this order. Up to four, each of a
 * hired type.
 *
 * An escort gets its id, `escort-<n>`, when it joins, from a counter the
 * convoy saves and never turns back, so no two escorts a campaign ever
 * owns share one. It keeps the id for good, and joins a convoy only once.
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
	constructor({ escorts = [], nextEscortNumber }: { escorts?: Vehicle[]; nextEscortNumber?: number } = {}) {
		escorts.forEach(Convoy.assertConvoyEscort);
		if (escorts.length > MAX_CONVOY_ESCORTS) {
			throw new Error(`A convoy holds ${MAX_CONVOY_ESCORTS} escorts at most, not ${escorts.length}`);
		}
		const counter = nextEscortNumber ?? firstFreeEscortNumber(escorts);
		assertEscortIds({ escorts, nextEscortNumber: counter });
		let next = counter;
		escorts.forEach(escort => {
			if (idOf(escort) === null) giveId({ escort, id: `escort-${next++}` });
		});
		super({ escorts: [...escorts], nextEscortNumber: next });
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
	 * Changes fields as Model.set does, but throws, changing nothing, if the
	 * counter would go back and hand out an id again.
	 */
	public override set(changes: Partial<ConvoyData>): void {
		const before = this.nextEscortNumber;
		const after = changes.nextEscortNumber;
		if (before !== undefined && after !== undefined && after < before) {
			throw new RangeError(`Convoy.nextEscortNumber can't go back, from ${before} to ${after}`);
		}
		super.set(changes);
	}

	/**
	 * At four, taking another means dismissing one first
	 */
	public get isFull(): boolean {
		return this.escorts.length >= MAX_CONVOY_ESCORTS;
	}

	/**
	 * A newly acquired escort joins the end of the roster, with the next id
	 */
	public add(escort: Vehicle): void {
		Convoy.assertConvoyEscort(escort);
		if (this.escorts.includes(escort)) {
			throw new Error(`${escort.name} is already in the convoy`);
		}
		const held = idOf(escort);
		if (held !== null) {
			throw new Error(`${escort.name} (${held}) has joined a convoy before, and an escort joins only once`);
		}
		if (this.isFull) {
			throw new Error(`The convoy holds ${MAX_CONVOY_ESCORTS} escorts; dismiss one first`);
		}
		giveId({ escort, id: `escort-${this.nextEscortNumber}` });
		this.set({ escorts: [...this.escorts, escort], nextEscortNumber: this.nextEscortNumber + 1 });
	}

	/**
	 * Let an escort go, and the signature copy it brought with it, from
	 * whichever of these drivers holds it
	 */
	public dismiss({ escort, drivers }: { escort: Vehicle; drivers: readonly Driver[] }): void {
		if (!this.escorts.includes(escort)) {
			throw new Error(`${escort.name} is not in the convoy`);
		}
		this.escorts = this.escorts.filter(owned => owned !== escort);
		drivers.forEach(driver => driver.removeCardsBroughtBy(idOf(escort)));
	}

	/**
	 * The lost are gone for good: wrecked in a fight (`AfterFight.lost`), or
	 * with a run that failed. Nothing joins after a fight.
	 */
	public afterFight({ lost }: { lost: readonly Vehicle[] }): void {
		this.escorts = this.escorts.filter(owned => !lost.includes(owned));
	}
}

function idOf(escort: Vehicle): string | null {
	return escort.escort?.id ?? null;
}

function giveId({ escort, id }: { escort: Vehicle; id: string }): void {
	escort.set({ escort: { ...(escort.escort as EscortProfile), id } });
}

/** Ids already given out are well formed, each held once, and below the counter; no escort is listed twice. */
function assertEscortIds({ escorts, nextEscortNumber }: { escorts: readonly Vehicle[]; nextEscortNumber: number }): void {
	if (!Number.isInteger(nextEscortNumber) || nextEscortNumber < 1) {
		throw new RangeError(`Convoy.nextEscortNumber must be an integer >= 1, got ${nextEscortNumber}`);
	}
	const ids = new Set<string>();
	escorts.forEach((escort, index) => {
		if (escorts.indexOf(escort) !== index) throw new Error(`${escort.name} is in the convoy twice`);
		const id = idOf(escort);
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
	return escorts.reduce((highest, escort) => Math.max(highest, escortNumber(idOf(escort) ?? '') ?? 0), 0) + 1;
}
