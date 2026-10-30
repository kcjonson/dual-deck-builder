import { ESLint } from 'eslint';
import { resolve } from 'path';

/**
 * The unseeded-random ban in .eslintrc.js, run through ESLint's own config
 * lookup as `npm run lint` does. Compliant code never trips a ban, so without
 * this nothing fails when the override is dropped, its globs drift, or it
 * slips to a warning, which `npm run lint` exits 0 on.
 */

const repoRoot = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: repoRoot });
const guardRules = new Set(['no-restricted-properties', 'no-restricted-imports']);
const pointsAtRng = expect.stringContaining('src/renderer/game/core/Rng.ts');
const pointsAtClock = expect.stringContaining('context.clock');

/** The guard's errors on `code` linted as if at `path`. A snippet that fails to parse fails the test, saying why, rather than passing as clean. */
async function guardErrors(code: string, path: string): Promise<string[]> {
	const [result] = await eslint.lintText(code, { filePath: resolve(repoRoot, path) });
	expect(result.messages.filter((message) => message.fatal).map((message) => message.message)).toEqual([]);
	return result.messages
		.filter((message) => message.severity === 2 && guardRules.has(message.ruleId ?? ''))
		.map((message) => message.message);
}

describe('the unseeded-random lint ban', () => {
	it.each([
		'src/renderer/game/x.ts',
		'src/renderer/game/x.test.ts',
		'src/renderer/game/ai/x.ts',
		'src/renderer/game/ai/__tests__/x.test.ts',
		'src/renderer/game/campaign/x.ts',
		'src/renderer/game/campaign/stops/x.test.ts',
		'src/renderer/game/core/x.ts',
		'src/renderer/game/core/x.test.ts',
		'src/renderer/game/data/x.ts',
		'src/renderer/game/map/x.ts',
		'src/renderer/game/map/stages/x.test.ts',
		'src/renderer/game/mechanics/x.ts',
		'src/renderer/game/mechanics/__tests__/x.test.ts',
		'src/renderer/game/screens/combat/x.ts',
		'src/renderer/game/screens/combat/x.test.ts',
		'src/renderer/game/ui/x.ts',
		'src/renderer/game/ui/x.test.ts',
	])('errors on Math.random in %s, pointing at Rng', async (path) => {
		expect(await guardErrors('export const roll = Math.random();', path)).toEqual([pointsAtRng]);
	});

	// Both bans set no-restricted-properties, and an override's options replace
	// an earlier one's, so where they meet one entry has to carry both lists
	it.each([
		'src/renderer/game/x.ts',
		'src/renderer/game/core/x.ts',
		'src/renderer/game/screens/combat/x.ts',
		'src/renderer/game/ui/x.ts',
	])('keeps the timer ban beside it in %s', async (path) => {
		const code = 'export const now = Date.now();\nexport const roll = Math.random();';
		expect(await guardErrors(code, path)).toEqual([pointsAtClock, pointsAtRng]);
	});

	it.each([
		['computed access', "export const roll = Math['random']();"],
		['destructuring', 'export const { random } = Math;'],
		['crypto.getRandomValues', 'export const bytes = crypto.getRandomValues(new Uint32Array(1));'],
		['window.crypto.getRandomValues', 'export const bytes = window.crypto.getRandomValues(new Uint32Array(1));'],
		['self.crypto.randomUUID', 'export const id = self.crypto.randomUUID();'],
		["randomInt imported from 'crypto'", "import { randomInt } from 'crypto';\nexport const seed = randomInt(2 ** 31);"],
		["randomFillSync imported from 'node:crypto'", "import { randomFillSync } from 'node:crypto';\nexport const seeds = randomFillSync(new Uint32Array(500));"],
		["randomBytes on a default import of 'crypto'", "import crypto from 'crypto';\nexport const bytes = crypto.randomBytes(4);"],
	])('catches %s, pointing at Rng', async (_name, code) => {
		expect(await guardErrors(code, 'src/renderer/game/map/x.ts')).toEqual([pointsAtRng]);
	});

	it.each([
		["jest.spyOn(Math, 'random') in a test", "const random = jest.spyOn(Math, 'random');\nexpect(random).not.toHaveBeenCalled();\n", 'src/renderer/game/map/x.test.ts'],
		["createHash imported from 'crypto'", "import { createHash } from 'crypto';\nexport const digest = createHash('sha256').update('seed').digest('hex');", 'src/renderer/game/map/x.ts'],
	])('allows %s', async (_name, code, path) => {
		expect(await guardErrors(code, path)).toEqual([]);
	});
});
