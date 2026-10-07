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

/** The guard's errors on `code` linted as if at `path`. A snippet that fails to parse fails the test rather than passing as clean. */
async function guardErrors(code: string, path: string): Promise<string[]> {
	const [result] = await eslint.lintText(code, { filePath: resolve(repoRoot, path) });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages
		.filter((message) => message.severity === 2 && guardRules.has(message.ruleId ?? ''))
		.map((message) => message.message);
}

describe('the unseeded-random lint ban', () => {
	it.each([
		'src/renderer/game/map/x.ts',
		'src/renderer/game/map/stages/x.test.ts',
		'src/renderer/game/campaign/x.ts',
		'src/renderer/game/campaign/stops/x.test.ts',
	])('errors on Math.random in %s, pointing at Rng', async (path) => {
		expect(await guardErrors('export const roll = Math.random();', path)).toEqual([pointsAtRng]);
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

	it("allows jest.spyOn(Math, 'random') in a test", async () => {
		const code = "const random = jest.spyOn(Math, 'random');\nexpect(random).not.toHaveBeenCalled();\n";
		expect(await guardErrors(code, 'src/renderer/game/map/x.test.ts')).toEqual([]);
	});
});
