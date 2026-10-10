import type { DriverArchetype } from '../mechanics/Driver';
import type { Campaign } from './Campaign';
import type { CampaignEnd } from './CampaignEnd';
import type { DriverRecord, DriverStatus } from './DriverRecord';

/**
 * Why a driver can't take a seat on a run, which load out shows under their
 * card: the campaign is over (its `end` says how), they're injured and fit
 * in `injuredDays`, they're away (dead, missing, or any other status that
 * isn't ready), they already hold the other seat, or they're the archetype
 * of the driver who does (the no-duplicate pair rule, which gives way when
 * no pair of different archetypes is ready: `getCrewRule`).
 */
export type SeatBlocker =
	| { reason: 'campaign_over'; end: Readonly<CampaignEnd> }
	| { reason: 'injured'; injuredDays: number }
	| { reason: 'driver_away'; status: Exclude<DriverStatus, 'ready' | 'injured'> }
	| { reason: 'already_seated' }
	| { reason: 'same_archetype'; archetype: DriverArchetype; partner: DriverRecord };

/**
 * Who a run can seat, from the drivers ready at the compound (DDB-432 #35):
 * a pair of different archetypes while two such are ready (`pair`); a pair
 * of one archetype when every ready driver shares it (`same_archetype`), so
 * a pool that only grows on runs can't lock itself out; one driver when
 * only one is ready (`solo`); or nobody (`none`), once the campaign is over
 * too. Injured drivers aren't ready, so they count once they're fit.
 */
export type CrewRule = 'pair' | 'same_archetype' | 'solo' | 'none';

export function getCrewRule({ campaign }: { campaign: Campaign }): CrewRule {
	if (campaign.end !== null) return 'none';
	const ready = campaign.drivers.filter(driver => driver.status === 'ready');
	if (ready.length === 0) return 'none';
	if (ready.length === 1) return 'solo';
	return ready.some(driver => driver.archetype !== ready[0].archetype) ? 'pair' : 'same_archetype';
}

/**
 * Why `driver` can't be seated beside `partner`, the driver in the other
 * seat if there is one, or null if they can, in this order: the campaign
 * is over, they're injured, they're any other status but ready, they're
 * the partner, or they're the partner's archetype while the crew rule
 * seats a pair of different archetypes (`getCrewRule`). Load out (DDB-320)
 * asks it of each driver in the pool, and the combat bridge refuses a
 * fight whose seats it refuses. Throws on a driver or partner outside the
 * campaign's pool.
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
	if (partner !== null && partner.archetype === driver.archetype && getCrewRule({ campaign }) === 'pair') {
		return { reason: 'same_archetype', archetype: driver.archetype, partner };
	}
	return null;
}
