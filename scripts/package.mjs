// Packages a Release build of the game as a playtest download (playtest-distribution.md):
//   node scripts/package.mjs --build-dir <dir> --config Release --platform win|mac --arch x64|arm64 \
//     --build <n> --sha <sha> --out <dir>
// writes <out>/WastelandWheels-<n>-<platform>-<arch>.zip and prints its path. The zip holds one folder,
// WastelandWheels/, with a README.txt and, on Windows, wasteland-wheels.exe, the DLLs it loads and its fonts/ and
// packs/; on macOS, Wasteland Wheels.app, ad-hoc signed, its files in Contents/Resources. Run it on the platform it
// packages: the zip is PowerShell's Compress-Archive on Windows and ditto on macOS, which keeps the bundle whole.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const kFolder = 'WastelandWheels';
const kWinExe = 'wasteland-wheels.exe';
const kMacApp = 'Wasteland Wheels.app';

class PackageError extends Error {}

function fail(message) {
	throw new PackageError(message);
}

function parseArgs(argv) {
	const names = ['build-dir', 'config', 'platform', 'arch', 'build', 'sha', 'out'];
	const args = {};
	for (let i = 0; i < argv.length; i += 1) {
		const name = argv[i].replace(/^--/, '');
		if (!argv[i].startsWith('--') || !names.includes(name) || i + 1 === argv.length) fail(`unexpected argument ${argv[i]}`);
		args[name] = argv[(i += 1)];
	}
	const missing = names.filter((name) => args[name] === undefined);
	if (missing.length > 0) fail(`missing --${missing.join(', --')}`);
	if (!['win', 'mac'].includes(args.platform)) fail(`--platform is win or mac, not ${args.platform}`);
	if (!['x64', 'arm64'].includes(args.arch)) fail(`--arch is x64 or arm64, not ${args.arch}`);
	if (args.platform === 'win' && args.arch !== 'x64') fail('Windows builds are x64 only');
	if (!/^\d+$/.test(args.build)) fail(`--build is a number, not ${args.build}`);
	if (!/^[0-9a-f]{7,40}$/i.test(args.sha)) fail(`--sha is a commit hash, not ${args.sha}`);
	const host = { win32: 'win', darwin: 'mac' }[process.platform];
	if (host !== args.platform) fail(`a ${args.platform} build is packaged on ${args.platform}, not ${process.platform}`);
	return args;
}

// The game's folder in the build tree: <config>/ under a multi-config generator, the folder itself under a
// single-config one.
function gameDir(buildDir, config, artifact) {
	const app = join(resolve(buildDir), 'apps', 'wasteland-wheels');
	for (const dir of [join(app, config), app]) {
		if (existsSync(join(dir, artifact))) return dir;
	}
	return fail(`no ${artifact} under ${app}; build the game in ${config} first`);
}

// The DLLs a PE image imports, read from its import directory.
function peImports(file) {
	const image = readFileSync(file);
	const pe = image.readUInt32LE(0x3c);
	if (image.toString('latin1', pe, pe + 4) !== 'PE\0\0') fail(`${file} isn't a PE image`);
	const sections = image.readUInt16LE(pe + 6);
	const optional = pe + 24;
	const magic = image.readUInt16LE(optional);
	const directories = optional + (magic === 0x20b ? 112 : 96);
	const importRva = image.readUInt32LE(directories + 8);
	const sectionTable = optional + image.readUInt16LE(pe + 20);
	const offsetOf = (rva) => {
		for (let i = 0; i < sections; i += 1) {
			const header = sectionTable + i * 40;
			const virtualAddress = image.readUInt32LE(header + 12);
			const size = Math.max(image.readUInt32LE(header + 8), image.readUInt32LE(header + 16));
			if (rva >= virtualAddress && rva < virtualAddress + size) return rva - virtualAddress + image.readUInt32LE(header + 20);
		}
		return fail(`${file}: an import points outside its sections`);
	};
	const names = [];
	if (importRva === 0) return names;
	for (let descriptor = offsetOf(importRva); image.readUInt32LE(descriptor + 12) !== 0; descriptor += 20) {
		const start = offsetOf(image.readUInt32LE(descriptor + 12));
		names.push(image.toString('latin1', start, image.indexOf(0, start)));
	}
	return names;
}

// The exe, the DLLs beside it that it loads, theirs in turn, and its files. A DLL that isn't beside it is Windows'
// own, except the Visual C++ runtime, which the build stages beside the game for machines without the redistributable.
function stageWindows(dir, stage) {
	const beside = new Map(readdirSync(dir).map((file) => [file.toLowerCase(), file]));
	const shipped = new Set();
	const visit = (file) => {
		for (const imported of peImports(file)) {
			const name = beside.get(imported.toLowerCase());
			if (name !== undefined && !shipped.has(name)) {
				shipped.add(name);
				cpSync(join(dir, name), join(stage, name));
				visit(join(dir, name));
			} else if (name === undefined && /^(msvcp|vcruntime|concrt)\d/i.test(imported)) {
				fail(`${kWinExe} loads ${imported}, which isn't beside it; the build stages the Visual C++ runtime there`);
			}
		}
	};
	visit(join(dir, kWinExe));
	cpSync(join(dir, kWinExe), join(stage, kWinExe));
	for (const folder of ['fonts', 'packs']) {
		if (!existsSync(join(dir, folder))) fail(`no ${folder}/ beside ${kWinExe}`);
		cpSync(join(dir, folder), join(stage, folder), { recursive: true });
	}
	console.error(`package: ${kWinExe} with ${[...shipped].join(', ')}`);
	return join(stage, kWinExe);
}

// The bundle, copied by ditto so nothing in it changes, checked to load no library outside the system's, and signed
// ad hoc: an Apple Silicon Mac refuses an unsigned one as damaged, and the linker's signature doesn't cover the
// resources staged after it.
function stageMac(dir, stage) {
	const app = join(stage, kMacApp);
	execFileSync('ditto', [join(dir, kMacApp), app]);
	for (const folder of ['fonts', 'packs']) {
		if (!existsSync(join(app, 'Contents', 'Resources', folder))) fail(`no ${folder}/ in ${kMacApp}/Contents/Resources`);
	}
	const exe = join(app, 'Contents', 'MacOS', 'Wasteland Wheels');
	const linked = execFileSync('otool', ['-L', exe], { encoding: 'utf8' })
		.split('\n')
		.slice(1)
		.map((line) => line.trim().split(' (')[0])
		.filter(Boolean);
	const foreign = linked.filter((library) => !/^\/(System\/Library|usr\/lib)\//.test(library));
	if (foreign.length > 0) fail(`${kMacApp} loads libraries a player won't have: ${foreign.join(', ')}`);
	execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
	execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
	return exe;
}

// The staged game's --check, from another working directory: it loads its packs and faces from its own folder as
// startup does, with no window, and prints its build line, which has to be this build's.
function check(exe, stamp, cwd) {
	let output;
	try {
		output = execFileSync(exe, ['--check'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (error) {
		fail(`the staged game's --check failed:\n${error.stdout ?? ''}${error.stderr ?? error.message}`);
	}
	if (!output.includes(stamp)) fail(`the staged game says "${output.trim()}", not ${stamp}; configure with this build's number and SHA`);
	console.error(`package: ${output.trim()}`);
}

function readme(platform, stamp) {
	const lines =
		platform === 'win'
			? [
					'Unzip the folder anywhere and run wasteland-wheels.exe inside it. Keep the files beside it together:',
					'the game reads its fonts and packs from its own folder.',
					'',
					"The build isn't signed, so the first run stops at \"Windows protected your PC\". Choose More info,",
					'then Run anyway.',
					'',
					'Saves are in %LOCALAPPDATA%\\Bear Cave Interactive\\Wasteland Wheels\\saves and settings in',
					'%APPDATA%\\Bear Cave Interactive\\Wasteland Wheels; deleting the game folder keeps them. Each run',
					"writes a log to %TEMP%\\Wasteland Wheels, which helps with a bug report.",
				]
			: [
					'Unzip it and drag Wasteland Wheels.app to Applications, or run it from where it is.',
					'',
					"The build isn't signed by a registered developer, so the first open stops at \"Apple could not",
					'verify...". Open System Settings > Privacy & Security, scroll down, and choose Open Anyway beside',
					'the message about Wasteland Wheels. Or, in Terminal:',
					'',
					'    xattr -dr com.apple.quarantine "/Applications/Wasteland Wheels.app"',
					'',
					'Saves and settings are under ~/Library/Application Support/Bear Cave Interactive; deleting the app',
					'keeps them. Each run writes a log, which helps with a bug report: open "$TMPDIR/Wasteland Wheels"',
					'in Terminal to find it.',
				];
	const footer = `The menu and the splash say ${stamp}; put it in a bug report.`;
	return [`Wasteland Wheels, early alpha, ${stamp}`, '', ...lines, '', footer, ''].join(platform === 'win' ? '\r\n' : '\n');
}

const work = mkdtempSync(join(tmpdir(), 'ww-package-'));
try {
	const args = parseArgs(process.argv.slice(2));
	const stamp = `BUILD ${args.build} - ${args.sha.slice(0, 7).toLowerCase()}`;
	const out = resolve(args.out);
	const zip = join(out, `${kFolder}-${args.build}-${args.platform}-${args.arch}.zip`);
	const dir = gameDir(args['build-dir'], args.config, args.platform === 'win' ? kWinExe : kMacApp);
	const stage = join(work, kFolder);
	mkdirSync(stage);
	const exe = args.platform === 'win' ? stageWindows(dir, stage) : stageMac(dir, stage);
	check(exe, stamp, work);
	writeFileSync(join(stage, 'README.txt'), readme(args.platform, stamp));
	mkdirSync(out, { recursive: true });
	rmSync(zip, { force: true });
	if (args.platform === 'win') {
		const quote = (path) => `'${path.replaceAll("'", "''")}'`;
		const command = `$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path ${quote(stage)} -DestinationPath ${quote(zip)}`;
		execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' });
	} else {
		execFileSync('ditto', ['-c', '-k', '--keepParent', stage, zip]);
	}
	console.log(zip);
} catch (error) {
	if (!(error instanceof PackageError)) throw error;
	console.error(`package: ${error.message}`);
	process.exitCode = 1;
} finally {
	rmSync(work, { recursive: true, force: true });
}
