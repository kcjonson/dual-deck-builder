// Checks the C++ sources against .clang-format, or rewrites them with --fix.
//   node scripts/format.mjs          exit 1 and list the files that would change
//   node scripts/format.mjs --fix    format them in place
// clang-format output drifts between major versions, so this holds to 21, the version
// worldsim and salal check with. CLANG_FORMAT names the binary if it isn't on PATH.
import { execFileSync, spawnSync } from 'node:child_process';

const kMajor = 21;
const fix = process.argv.includes('--fix');
const binary = process.env.CLANG_FORMAT || 'clang-format';

let version;
try {
	version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
} catch {
	console.error(`${binary} not found; install clang-format ${kMajor} or set CLANG_FORMAT.`);
	process.exit(2);
}
const major = Number(version.match(/version (\d+)\./)?.[1]);
if (major !== kMajor) {
	console.error(`${binary} is ${version.trim()}; this repo formats with clang-format ${kMajor}.`);
	process.exit(2);
}

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'libs/*.h', 'libs/*.cpp', 'apps/*.h', 'apps/*.cpp'], {
	encoding: 'utf8',
})
	.split('\n')
	.filter(Boolean);

let failed = false;
for (let i = 0; i < files.length; i += 50) {
	const batch = files.slice(i, i + 50);
	const args = fix ? ['-i', ...batch] : ['--dry-run', '--Werror', ...batch];
	const result = spawnSync(binary, args, { stdio: 'inherit' });
	if (result.status !== 0) failed = true;
}

if (!fix) console.log(failed ? 'Formatting differs; run node scripts/format.mjs --fix.' : `${files.length} files formatted.`);
process.exit(failed ? 1 : 0);
