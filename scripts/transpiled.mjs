/**
 * Runs a script on the game's own TypeScript outside Jest, whose coverage
 * instrumentation and vm context slow game code several times over: it
 * transpiles the entries and every module they reach by relative import,
 * JSON included and type-only imports left out, into a temporary folder
 * laid out as the repository is, then runs the script again in a fresh
 * child process, clear of the TypeScript compiler's heap, with the folder
 * as `build`. balance-sim, road-network, terrain-bench, and
 * area-map-bake-bench all start here.
 *
 *   const { build, args } = await transpiled({ script: fileURLToPath(import.meta.url), name: 'my-bench', entries: ['src/renderer/game/core/Rng.ts'] });
 *   const load = createRequire(join(build, 'src/renderer/game/index.js'));
 *   const { Rng } = load('./core/Rng.js');
 *
 * In the parent this never returns: it exits with the child's status.
 * `nodeFlags` go to the child's node, before the script.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BUILT = '--built';
// An import or re-export from a relative path, at the start of a line; `type` marks the ones the transpiler drops.
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;

/**
 * The child's build folder and its own arguments (everything after the
 * script's), or, in the parent, transpile, run the child, and exit.
 */
export async function transpiled({ script, name, entries, nodeFlags = [] }) {
	if (process.argv[2] === BUILT) return { build: process.argv[3], args: process.argv.slice(4) };
	const build = mkdtempSync(join(tmpdir(), `${name}-`));
	let status = 1;
	try {
		await transpileInto({ build, entries });
		status = spawnSync(process.execPath, [...nodeFlags, script, BUILT, build, ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd() }).status ?? 1;
	} finally {
		rmSync(build, { recursive: true, force: true });
	}
	process.exit(status);
}

/** Transpiles `entries` (paths from the repository root) and what they reach into `build`, as CommonJS. */
export async function transpileInto({ build, entries }) {
	const { default: ts } = await import('typescript');
	const pending = entries.map(entry => join(ROOT, entry));
	const done = new Set();
	while (pending.length > 0) {
		const file = pending.pop();
		if (done.has(file)) continue;
		done.add(file);
		const target = join(build, relative(ROOT, file)).replace(/\.ts$/, '.js');
		mkdirSync(dirname(target), { recursive: true });
		if (file.endsWith('.json')) {
			copyFileSync(file, target);
			continue;
		}
		const text = readFileSync(file, 'utf8');
		for (const [, typeOnly, specifier] of text.matchAll(IMPORT)) {
			if (typeOnly) continue;
			const base = resolve(dirname(file), specifier);
			const found = (base.endsWith('.json') ? [base] : [`${base}.ts`, join(base, 'index.ts')]).find(candidate => existsSync(candidate));
			if (found) pending.push(found);
		}
		const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true } });
		writeFileSync(target, outputText);
	}
}
