import { Model } from '../core/Model';
import { Driver } from './Driver';
import { EscortDividend } from './Escort';
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
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Convoy extends ConvoyData {}

/**
 * The escorts you own, in roster order (first acquired first), between
 * fights. A player team fields them in this order. Up to four.
 */
export class Convoy extends Model<ConvoyData> {
	static properties = new Set<keyof ConvoyData>([
		'escorts'
	]);

	constructor({ escorts = [] }: { escorts?: Vehicle[] } = {}) {
		escorts.forEach(Convoy.assertConvoyEscort);
		if (escorts.length > MAX_CONVOY_ESCORTS) {
			throw new Error(`A convoy holds ${MAX_CONVOY_ESCORTS} escorts at most, not ${escorts.length}`);
		}
		super({ escorts: [...escorts] });
	}

	private static assertConvoyEscort(vehicle: Vehicle): void {
		if (!vehicle.isEscort) {
			throw new Error(`${vehicle.name} is not an escort`);
		}
		if (vehicle.escort?.setPiece) {
			throw new Error(`${vehicle.name} is a set-piece ally, not the convoy's`);
		}
	}

	/**
	 * At four, taking another means dismissing one first
	 */
	public get isFull(): boolean {
		return this.escorts.length >= MAX_CONVOY_ESCORTS;
	}

	/**
	 * A newly acquired escort joins the end of the roster
	 */
	public add(escort: Vehicle): void {
		Convoy.assertConvoyEscort(escort);
		if (this.escorts.includes(escort)) {
			throw new Error(`${escort.name} is already in the convoy`);
		}
		if (this.isFull) {
			throw new Error(`The convoy holds ${MAX_CONVOY_ESCORTS} escorts; dismiss one first`);
		}
		this.escorts = [...this.escorts, escort];
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
		drivers.forEach(driver => driver.removeCardsBroughtBy(escort.id));
	}

	/**
	 * The lost are gone for good: wrecked in a fight (`AfterFight.lost`), or
	 * with a run that failed. Nothing joins after a fight.
	 */
	public afterFight({ lost }: { lost: readonly Vehicle[] }): void {
		this.escorts = this.escorts.filter(owned => !lost.includes(owned));
	}
}
