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
	 * Living escorts on the player team at the end, in team order, whatever
	 * made them escorts: the convoy's own and any driven vehicle that became
	 * one this fight. Set-piece allies aren't the convoy's and aren't here.
	 * Each has already left the road, with its armor refilled.
	 */
	escorts: Vehicle[];
	/** Convoy escorts wrecked this fight. The copies they brought have already left the decks. */
	lost: Vehicle[];
	/**
	 * What the surviving haulers paid, empty unless the fight was won. A heal has
	 * already landed on the drivers; fuel and scrap are for the run to add,
	 * since nothing holds them yet.
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
 * fights. Run state: a player team fields them in this order. Up to four;
 * a fight can leave a fifth (a driven vehicle that became an escort), and
 * the convoy holds that over-cap state until one is dismissed, since a
 * team can't field it.
 */
export class Convoy extends Model<ConvoyData> {
	static properties = new Set<keyof ConvoyData>([
		'escorts'
	]);

	constructor({ escorts = [] }: { escorts?: Vehicle[] } = {}) {
		escorts.forEach(Convoy.assertConvoyEscort);
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
	 * More than a team can field, after a fight left a fifth
	 */
	public get isOverCap(): boolean {
		return this.escorts.length > MAX_CONVOY_ESCORTS;
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
	 * The lost are gone for the run. Anything that became an escort during
	 * the fight joins the end of the roster, even past the cap.
	 */
	public afterFight({ escorts, lost }: AfterFight): void {
		const kept = this.escorts.filter(owned => !lost.includes(owned));
		const joined = escorts.filter(escort => !kept.includes(escort));
		this.escorts = [...kept, ...joined];
	}
}
