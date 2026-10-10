import type { DriverArchetype } from '../mechanics/Driver';
import type { Campaign } from './Campaign';
import type { CampaignEnd } from './CampaignEnd';
import type { DriverRecord, DriverStatus } from './DriverRecord';

/**
 * Why a driver can't take a seat on a run, which load out shows under their
 * card: the campaign is over (its `end` says how), they're injured and fit
 * in `injuredDays`, they're away (dead, missing, or any other status that
 * isn't ready), they already hold the other seat, or they're the archetype
 * of the driver who does (the no-duplicate pair rule).
 */
export type SeatBlocker =
	| { reason: 'campaign_over'; end: Readonly<CampaignEnd> }
	| { reason: 'injured'; injuredDays: number }
	| { reason: 'driver_away'; status: Exclude<DriverStatus, 'ready' | 'injured'> }
	| { reason: 'already_seated' }
	| { reason: 'same_archetype'; archetype: DriverArchetype; partner: DriverRecord };

/**
 * Why `driver` can't be seated beside `partner`, the driver in the other
 * seat if there is one, or null if they can, in this order: the campaign
 * is over, they're injured, they're any other status but ready, they're the partner, or
 * they're the partner's archetype. Load out (DDB-320) asks it of each driver
 * in the pool, and the combat bridge refuses a fight whose seats it refuses.
 * Throws on a driver or partner outside the campaign's pool.
 */
export function getSeatBlocker({ campaign, driver, partner = null }: {
	campaign: Campaign;
	driver: DriverRecord;
	partner?: DriverRecord | null;
}): SeatBlocker | null {
	for (const record of partner === null ? [driver] : [driver, partner]) {
		if (!campaign.drivers.includes(record)) throw new RangeError(`${record.name} (${record.id}) isn't in this campaign's pool`);
	}
	if (campaign.end !== null) return { reason: 'campaign_over', end: campaign.end };
	if (driver.status === 'injured') return { reason: 'injured', injuredDays: driver.injuredDays };
	if (driver.status !== 'ready') return { reason: 'driver_away', status: driver.status };
	if (partner === driver) return { reason: 'already_seated' };
	if (partner !== null && partner.archetype === driver.archetype) return { reason: 'same_archetype', archetype: driver.archetype, partner };
	return null;
}
