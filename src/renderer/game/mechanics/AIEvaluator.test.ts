import cardsFile from '../data/cards.json';
import { AIEvaluationResult, AIEvaluator, EvaluationConfig } from './AIEvaluator';
import { AIType } from '../ai/AIController';
import { CardLoader } from '../core/CardLoader';
import { DriverLoader } from '../core/DriverLoader';

/**
 * DDB-399: an evaluation run replays from its seed, which every result
 * carries, and a pair's random drivers don't depend on the order the AI
 * types are listed in.
 */

const originalFetch = global.fetch;

beforeAll(async () => {
	global.fetch = jest.fn().mockResolvedValue({
		ok: true,
		statusText: 'OK',
		json: async () => cardsFile,
	}) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();
});

afterAll(() => {
	global.fetch = originalFetch;
});

beforeEach(() => {
	// Drivers log every draw
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
	jest.restoreAllMocks();
});

const evaluate = (config: EvaluationConfig): Promise<Map<AIType, AIEvaluationResult>> => new AIEvaluator().evaluateAllAI(config);

/** Every match once, by its AIs, drivers, and outcome, in a fixed order */
const matchesOf = (results: Map<AIType, AIEvaluationResult>): string[] => [...results.values()]
	.flatMap(result => result.matchResults)
	.map(match => `${match.player1AI} v ${match.player2AI}, ${match.player1Drivers.join(' and ')}: ${match.winner} in ${match.turnsPlayed}`)
	.sort();

describe('AIEvaluator', () => {
	it('returns the run\'s seed on every result, and the seed replays the run', async () => {
		const config: EvaluationConfig = { aiTypes: ['random', 'aggressive'], gamesPerMatchup: 2, randomizeDrivers: true };

		const first = await evaluate(config);
		const seeds = new Set([...first.values()].map(result => result.seed));
		expect(seeds.size).toBe(1);

		expect(await evaluate({ ...config, seed: [...seeds][0] })).toEqual(first);
	});

	it('draws a pair\'s drivers the same whichever of the two is listed first', async () => {
		const config = { gamesPerMatchup: 3, randomizeDrivers: true, seed: 20261007 };

		const forward = matchesOf(await evaluate({ ...config, aiTypes: ['random', 'aggressive'] }));
		const backward = matchesOf(await evaluate({ ...config, aiTypes: ['aggressive', 'random'] }));

		expect(forward).toHaveLength(6);
		expect(backward).toEqual(forward);
	});
});
