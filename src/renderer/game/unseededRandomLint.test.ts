import { ESLint } from 'eslint';
import { resolve } from 'path';

/**
 * The unseeded-random ban in .eslintrc.js, run through ESLint's own config
 * lookup as `npm run lint` does. Compliant code never trips a ban, so without
 * this nothing fails when the override is dropped or its globs drift.
 */

const repoRoot = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: repoRoot });

async function restrictions(code: string, path: string): Promise<string[]> {
	const [result] = await eslint.lintText(code, { filePath: resolve(repoRoot, path) });
	return result.messages.filter((message) => message.ruleId === 'no-restricted-properties').map((message) => message.message);
}

describe('the unseeded-random lint ban', () => {
	it.each([
		'src/renderer/game/map/x.ts',
		'src/renderer/game/campaign/x.ts',
		'src/renderer/game/map/stages/x.test.ts',
	])('errors on Math.random in %s, pointing at Rng', async (path) => {
		expect(await restrictions('export const roll = Math.random();', path)).toEqual([
			expect.stringContaining('src/renderer/game/core/Rng.ts'),
		]);
	});

	it.each([
		['computed access', "export const roll = Math['random']();"],
		['destructuring', 'export const { random } = Math;'],
		['crypto.getRandomValues', 'export const bytes = crypto.getRandomValues(new Uint32Array(1));'],
		['window.crypto.getRandomValues', 'export const bytes = window.crypto.getRandomValues(new Uint32Array(1));'],
		['self.crypto.randomUUID', 'export const id = self.crypto.randomUUID();'],
	])('catches %s', async (_name, code) => {
		expect(await restrictions(code, 'src/renderer/game/map/x.ts')).toHaveLength(1);
	});

	it("allows jest.spyOn(Math, 'random') in a test", async () => {
		const code = "const random = jest.spyOn(Math, 'random');\nexpect(random).not.toHaveBeenCalled();\n";
		expect(await restrictions(code, 'src/renderer/game/map/x.test.ts')).toEqual([]);
	});
});
