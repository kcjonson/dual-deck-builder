import { areaMapPipeline } from '../../map/AreaMapPipeline';
import type { MapParams } from '../../map/MapParams';
import { MapGenerationCancelled, type MapGenerationResult } from '../../map/worker/MapGeneration';
import type { Campaign } from '../Campaign';
import type { FoundingGeneration, StartGeneration } from '../CampaignFounding';
import { FoundingMap, FoundingOptions, foundCampaign, prepareFounding } from '../Founding';

/**
 * Founding without generating a map, for tests about everything else a
 * campaign holds: a generation takes most of a second, and these tests
 * found hundreds of campaigns.
 */

/** Every stage of today's pipeline on its first attempt, the way most maps are made. */
export function firstAttempts(): Record<string, number> {
	return Object.fromEntries(areaMapPipeline().stageNames.map((name) => [name, 0]));
}

/** A map founding accepts for `params`, made on the first attempt of everything, with nothing generated. */
export function stubMap(params: Readonly<MapParams>): FoundingMap {
	return { params, mapAttempt: 0, attempts: firstAttempts() };
}

/**
 * `foundCampaign` on a stub map for the params founding resolves from these
 * options. Options founding refuses get a map it never looks at, so the
 * error is founding's own.
 */
export function foundTestCampaign(options: Omit<FoundingOptions, 'map'>): Campaign {
	let map: FoundingMap;
	try {
		map = stubMap(prepareFounding(options).params);
	} catch {
		map = { params: {} as MapParams, mapAttempt: 0, attempts: {} };
	}
	return foundCampaign({ ...options, map });
}

/** A generation result with no products, which founding and the map cache only pass along. */
export function stubResult(params: Readonly<MapParams>): MapGenerationResult {
	return { ...stubMap(params), params } as unknown as MapGenerationResult;
}

/** A generation that resolves with `stubResult` a task later, and rejects with MapGenerationCancelled if cancelled first, as MapGeneration does. */
export const stubGeneration: StartGeneration = ({ params }): FoundingGeneration => {
	let cancel = (): void => undefined;
	const result = new Promise<MapGenerationResult>((resolve, reject) => {
		const timer = setTimeout(() => resolve(stubResult(params)), 0);
		cancel = () => {
			clearTimeout(timer);
			reject(new MapGenerationCancelled());
		};
	});
	result.catch(() => undefined);
	return { result, cancel: () => cancel() };
};
