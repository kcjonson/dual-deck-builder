import type { DriverArchetype } from '../mechanics/Driver';
import type { Campaign } from './Campaign';
import type { DriverRecord } from './DriverRecord';

/**
 * Why a driver can't take a seat on a run, which load out shows under their
 * card: they're away (dead, or missing), injured and fit in `injuredDays`,
 * or the same archetype as the driver in the other seat (the no-duplicate
 * pair rule).
 */
export type SeatBlocker =
	| { reason: 'driver_away'; status: 'dead' | 'missing' }
	| { reason: 'injured'; injuredDays: number }
	| { reason: 'same_archetype'; archetype: DriverArchetype; partner: DriverRecord };

/**
 * Why `driver` can't be seated beside `partner`, the driver in the other
 * seat if there is one, or null if they can, in this order: they're dead or
 * missing, they're injured, or they're the partner's archetype. Load out
 * (DDB-320) asks it of each driver in the pool, and the combat bridge
 * refuses a fight whose seats it refuses. Throws on a driver or partner
 * outside the campaign's pool.
 */
export function getSeatBlocker({ campaign, driver, partner = null }: {
	campaign: Campaign;
	driver: DriverRecord;
	partner?: DriverRecord | null;
}): SeatBlocker | null {
	for (const record of partner === null ? [driver] : [driver, partner]) {
		if (!campaign.drivers.includes(record)) throw new RangeError(`${record.name} (${record.id}) isn't in this campaign's pool`);
	}
	if (driver.status === 'dead' || driver.status === 'missing') return { reason: 'driver_away', status: driver.status };
	if (driver.status === 'injured') return { reason: 'injured', injuredDays: driver.injuredDays };
	if (partner !== null && partner.archetype === driver.archetype) return { reason: 'same_archetype', archetype: driver.archetype, partner };
	return null;
}
