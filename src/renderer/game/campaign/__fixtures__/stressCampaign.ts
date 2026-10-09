import type { JsonObject } from '../../core/Json';
import { Rng } from '../../core/Rng';
import cardsFile from '../../data/cards.json';
import { resolveMapParams } from '../../map/MapParams';
import { Convoy } from '../../mechanics/Convoy';
import { createEscort } from '../../mechanics/Escort';
import { Campaign } from '../Campaign';
import { DRIVER_ARCHETYPES } from '../DriverRecord';

const CARD_TYPES = cardsFile.cards.map(card => card.type);

/** The spec's expected sizes (Area Map Generation, Performance): a few hundred stretches, about 40 POIs, about 300 stops. */
const ROADS = 300;
const POINTS_PER_ROAD = 12;
const POIS = 40;
const STOPS = 300;

/**
 * A long campaign, larger in every list than play should reach: day 400,
 * 60 drivers with full decks, every card type in the locker, a full convoy of four,
 * eight strongholds, 2,000 log lines, and a stand-in gameplay map at the
 * spec's sizes (polylines to a tenth of a world unit, POIs with approaches,
 * stops with their state, 64 by 64 land fog). It measures how big a save
 * gets, and how long one takes, until the map generator makes real maps.
 */
export function stressCampaign(): Campaign {
	const seed = 4242;
	const rng = new Rng({ seed }).fork('stress');
	const campaign = new Campaign({
		seed,
		generatorVersion: 1,
		mapParams: resolveMapParams({ seed, environment: 'rustBelt' }).params,
		map: stressMap(rng.fork('map')),
		resources: { food: 1240, water: 980, fuel: 312, meds: 87, scrap: 4310, people: 260 },
		unrest: 12,
		locker: Object.fromEntries(CARD_TYPES.map(type => [type, rng.int(1, 9)])),
		convoy: new Convoy({ escorts: (['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'] as const).map(type => createEscort({ type })) })
	});
	for (let index = 0; index < 60; index += 1) {
		const driver = campaign.recruitDriver({ archetype: DRIVER_ARCHETYPES[index % DRIVER_ARCHETYPES.length] });
		const deck = Object.fromEntries(rng.shuffle([...CARD_TYPES]).slice(0, 8).map((type, slot) => [type, slot < 4 ? 3 : 2]));
		driver.set(index % 3 === 0
			? { status: 'dead', hitpoints: 0, defaultDeck: {}, runsCompleted: rng.int(1, 40) }
			: { defaultDeck: deck, runsCompleted: rng.int(0, 40) });
	}
	campaign.set({ day: 400, strongholdsTaken: Array.from({ length: 8 }, (_, index) => `stronghold-${index + 1}`) });
	campaign.set({
		log: Array.from({ length: 2000 }, (_, index) => ({
			day: Math.floor(index / 5) + 1,
			message: `Interceptor ${index} came home from the run to the Saltflat Pumps with 3 fuel and 12 scrap.`
		}))
	});
	return campaign;
}

function stressMap(rng: Rng): JsonObject {
	// `|| 0` turns -0 into 0, which JSON writes the same way, so a reload compares equal.
	const coordinate = (): number => Math.round(rng.float() * 20000 - 10000) / 10 || 0;
	const roads = Array.from({ length: ROADS }, (_, index) => ({
		id: `road-${index}`,
		class: rng.pick(['highway', 'backRoad', 'trail']),
		parent: index === 0 ? null : `road-${rng.int(0, index - 1)}`,
		points: Array.from({ length: POINTS_PER_ROAD }, () => [coordinate(), coordinate()]),
		knowledge: rng.pick(['charted', 'rumored', 'uncharted'])
	}));
	const pois = Array.from({ length: POIS }, (_, index) => ({
		id: `poi-${index}`,
		kind: rng.pick(['hospital', 'water_plant', 'depot', 'stronghold']),
		tier: rng.int(1, 3),
		territory: `faction-${rng.int(1, 6)}`,
		at: [coordinate(), coordinate()],
		approaches: Array.from({ length: rng.int(2, 3) }, () => ({ road: `road-${rng.int(0, ROADS - 1)}`, attach: [coordinate(), coordinate()] })),
		stock: { food: rng.int(0, 9), scrap: rng.int(0, 9) },
		depleted: rng.float() < 0.2
	}));
	const stops = Array.from({ length: STOPS }, (_, index) => ({
		id: `stop-${index}`,
		road: `road-${rng.int(0, ROADS - 1)}`,
		at: Math.round(rng.float() * 1000) / 1000,
		type: rng.pick(['raider_ambush', 'checkpoint', 'hazard', 'find', 'event']),
		clearedDay: rng.float() < 0.5 ? rng.int(1, 400) : null,
		rolls: rng.int(0, 9)
	}));
	const fog = Array.from({ length: 128 }, () => rng.next());
	return { attempts: { map: 0, terrain: 0, scenery: 1 }, roads, pois, stops, fog };
}
