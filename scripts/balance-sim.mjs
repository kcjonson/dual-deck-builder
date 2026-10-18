/**
 * The balance sim's command line tool (docs/specs/Balance Simulation.md):
 * the sim core in src/renderer/game/sim/, transpiled by transpiled.mjs and
 * run outside Jest, its cells spread over worker threads.
 *
 *   node scripts/balance-sim.mjs fights [--routes 1,2,3,1+2] [--crews all|pairs|solo|road_warrior+interceptor,mechanic]
 *     [--seed 1] [--runs 150] [--turns 25] [--player aggressive] [--config tuning.json] [--json rows.json]
 *     [--workers 2] [--log road_warrior+interceptor:2:7]
 *   node scripts/balance-sim.mjs gen [--maps 30] [--seed 1] [--corpus routes.json] [--json gen.json] [--config tuning.json] [--workers 2]
 *
 * fights: every crew, fresh and on its default decks, through every route's
 * fights in order (`1+2` is a run's two fights, damage carried between them
 * as the combat bridge writes it back), with the aggressive AI on both
 * sides. Lost, down, turns, and injury days are over the runs that got
 * home; the by-seat column splits a pair's runs by who drives seat 1.
 *
 * gen: campaign maps from `rollParams` seeds `--seed` up, made as founding
 * makes them, and every route to every POI as a run gets it, measured by
 * destination tier against Runs and Encounters' bands: stops, fights, empty
 * stops, skulls, hours, own road (legs no other POI's routes use), last-leg
 * room, and what the nearest neighbor's run leaves cleared. --corpus writes
 * the routes, typed and audited, for `runs`.
 *
 * --config is a SimConfigInput as JSON (sim/SimConfig.ts): the tuning to try,
 * raider profiles and encounters among it; options given on the command
 * line win over it. --log prints one run's last fight: crew, route, and run
 * number. --json writes the resolved config and every row, each rate with
 * its count and 90% interval.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { transpiled } from './transpiled.mjs';

const script = fileURLToPath(import.meta.url);
const { build, args } = isMainThread
	? await transpiled({ script, name: 'balance-sim', entries: ['Fights', 'Gen', 'SimConfig'].map(module => `src/renderer/game/sim/${module}.ts`) })
	: { build: workerData.build, args: [] };

// Drivers log every draw, and the AIs think aloud
const print = (line = '') => process.stdout.write(`${line}\n`);
console.log = () => undefined;
console.info = () => undefined;
console.debug = () => undefined;
console.warn = () => undefined;

const load = createRequire(join(build, 'src/renderer/game/index.js'));
const { fightCells, fightLog, playFightCell } = load('./sim/Fights.js');
const { genCells, playGenCell, summarizeGen } = load('./sim/Gen.js');
const { simConfig } = load('./sim/SimConfig.js');

const MODES = {
	fights: { cells: fightCells, play: playFightCell, run: fights, options: ['runs', 'crews', 'routes', 'turns', 'player', 'log'] },
	gen: { cells: genCells, play: playGenCell, run: gen, options: ['maps', 'corpus'] },
};

async function main() {
	const [mode, ...rest] = args;
	if (!MODES[mode]) throw new Error(`balance-sim: the mode is one of ${Object.keys(MODES).join(', ')}, got ${mode ?? 'none'}`);
	const options = readOptions(rest, ['config', 'json', 'seed', 'workers', ...MODES[mode].options]);
	const input = configInput(options);
	await MODES[mode].run({ mode, options, input, config: simConfig(input), workers: whole(options, 'workers', 2) });
}

async function fights({ mode, options, input, config, workers }) {
	if (options.log) {
		const [crew, route, index, ...extra] = options.log.split(':');
		if (!crew || !route || !/^\d+$/.test(index ?? '') || extra.length > 0) throw new Error(`balance-sim: --log takes crew:route:run, like road_warrior+interceptor:2:7, got ${options.log}`);
		// The config's own cell when it asks for one, so its decks come along; otherwise that crew on its default decks
		const cell = fightCells(config).find(({ name }) => name === `${crew}:${route}`)
			?? fightCells(simConfig({ ...input, crews: [crew.split('+')], routes: [route.split('+').map(Number)] }))[0];
		const { lines, run } = await fightLog({ config, cell, index: Number(index) });
		lines.forEach(line => print(line));
		print(`\n${run.outcome === 'home' ? `won, HP lost ${percent(run.hpLost)}, structure lost ${percent(run.structureLost)}` : run.outcome}`);
		return;
	}

	print(`${config.runs} runs a cell, seed ${config.seed}, player AI ${config.playerAI}, stall after turn ${config.turns}`);
	print('Encounters: ' + Object.entries(config.encounters).map(([id, raiders]) => `${id} ${raiders.join(' + ')}`).join('; '));
	print('');
	print('crew          route   won  by seat  stall  HP lost  struct lost  down  turns  inj days  killed   (lost, down, turns, and injury days over runs won)');
	const rows = await playCells({ mode, input, count: fightCells(config).length, workers, onRow: printRow });
	printFairness(rows);
	if (options.json) writeFileSync(options.json, JSON.stringify({ mode, config, rows }, null, '\t'));
}

async function gen({ mode, options, input, config, workers }) {
	const count = genCells(config).length;
	print(`${count} campaign maps, rollParams seeds ${config.seed} to ${config.seed + count - 1}, every route to every POI`);
	const maps = await playCells({ mode, input, count, workers, onRow: (map) => process.stderr.write(`map ${map.seed}: ${map.failed ? `no map (${map.failed})` : `${map.environment}, ${map.routes.length} routes`}\n`) });
	const summary = summarizeGen({ config, maps });
	printGen(summary);
	if (options.corpus) {
		const corpus = { generatorVersion: maps[0]?.generatorVersion ?? null, seeds: maps.map(map => map.seed), maps: maps.map(({ seed, environment, failed, routes }) => ({ seed, environment, failed, routes })) };
		writeFileSync(options.corpus, JSON.stringify(corpus));
	}
	if (options.json) writeFileSync(options.json, JSON.stringify({ mode, config, summary, maps: maps.map(({ routes, ...map }) => map) }, null, '\t'));
}

/** Plays every cell on the workers, and hands each row on in cell order as soon as the ones before it are in. */
function playCells({ mode, input, count, workers, onRow }) {
	return new Promise((resolve, reject) => {
		const rows = new Array(count);
		let next = 0;
		let shown = 0;
		// Workers let go once the cells ran out; any other exit is a crash
		const done = new Set();
		const pool = Array.from({ length: Math.max(1, Math.min(workers, count)) }, () => new Worker(script, { workerData: { build, mode, input } }));
		const give = (worker) => {
			if (next < count) worker.postMessage(next++);
			else {
				done.add(worker);
				worker.terminate();
			}
		};
		for (const worker of pool) {
			worker.on('error', reject);
			worker.on('exit', (code) => {
				if (!done.has(worker)) reject(new Error(`balance-sim: a worker exited (${code}) with cells still to play`));
			});
			worker.on('message', ({ index, row }) => {
				rows[index] = row;
				while (shown < count && rows[shown]) onRow(rows[shown++]);
				if (shown === count) resolve(rows);
				give(worker);
			});
			give(worker);
		}
		if (count === 0) resolve(rows);
	});
}

function configInput(options) {
	const input = options.config ? JSON.parse(readFileSync(options.config, 'utf8')) : {};
	const number = (key) => (options[key] === undefined ? {} : { [key]: whole(options, key) });
	return {
		...input,
		...number('seed'),
		...number('runs'),
		...number('turns'),
		...number('maps'),
		...(options.player ? { playerAI: options.player } : {}),
		...(options.routes ? { routes: options.routes.split(',').map(route => route.split('+').map(Number)) } : {}),
		...(options.crews ? { crews: ['all', 'pairs', 'solo'].includes(options.crews) ? options.crews : options.crews.split(',').map(crew => crew.split('+')) } : {}),
	};
}

/** A whole-number option of 1 or more, or `fallback` when it's left out; `seed` may be 0. */
function whole(options, key, fallback) {
	if (options[key] === undefined) return fallback;
	const value = Number(options[key]);
	if (!Number.isInteger(value) || value < (key === 'seed' ? 0 : 1)) throw new Error(`balance-sim: --${key} takes a whole number${key === 'seed' ? '' : ' of 1 or more'}, got ${options[key]}`);
	return value;
}

function readOptions(list, known) {
	const options = {};
	for (let index = 0; index < list.length; index += 2) {
		const key = list[index].replace(/^--/, '');
		if (!known.includes(key)) throw new Error(`balance-sim: unknown option ${list[index]}`);
		if (list[index + 1] === undefined || list[index + 1].startsWith('--')) throw new Error(`balance-sim: ${list[index]} needs a value`);
		options[key] = list[index + 1];
	}
	return options;
}

const SHORT = { road_warrior: 'RW', interceptor: 'Int', mechanic: 'Mech', raider: 'Raid' };
const crewLabel = (crew) => crew.map(archetype => SHORT[archetype] ?? archetype).join(' + ');
const percent = (value) => (value === null || Number.isNaN(value) ? '-' : `${Math.round(value * 100)}%`).padStart(4);
const fixed = (value, digits = 1) => (value === null ? '-' : value.toFixed(digits));

function printRow(row) {
	const bySeat = row.bySeat ? row.bySeat.map(({ rate }) => (rate === null ? '-' : String(Math.round(rate * 100)))).join('/') : '';
	print(`${crewLabel(row.crew).padEnd(14)}${row.route.join('+').padStart(5)}  ${percent(row.won.rate)}  ${bySeat.padStart(7)}  ${percent(row.stalled.rate).padStart(5)}  ${percent(row.hpLost).padStart(7)}  ${percent(row.structureLost).padStart(11)}  ${percent(row.down.rate)}  ${fixed(row.turns).padStart(5)}  ${fixed(row.injuryDays).padStart(8)}  ${fixed(row.raidersKilled).padStart(6)}`);
}

/** Runs and Encounters, Fairness: the spread between the best and worst pair on a route, and each pair's seat gap. */
function printFairness(rows) {
	const pairs = rows.filter(row => row.crew.length === 2);
	if (pairs.length === 0) return;
	print('\nfairness, points of won: best pair less worst on each route; the widest gap between a pair\'s two seatings');
	for (const route of [...new Set(pairs.map(row => row.route.join('+')))]) {
		const onRoute = pairs.filter(row => row.route.join('+') === route);
		const rates = onRoute.map(row => row.won.rate);
		const gaps = onRoute.map(row => ({ row, gap: Math.abs((row.bySeat[0].rate ?? 0) - (row.bySeat[1].rate ?? 0)) }));
		const widest = gaps.reduce((best, next) => (next.gap > best.gap ? next : best));
		print(`${route.padStart(5)}  pairs ${String(Math.round((Math.max(...rates) - Math.min(...rates)) * 100)).padStart(3)}  seats ${String(Math.round(widest.gap * 100)).padStart(3)} (${crewLabel(widest.row.crew)})`);
	}
}

const spreadText = ({ mean, min, max }, digits = 1) => (mean === null ? '-' : `${mean.toFixed(digits)} (${min}-${max})`);
const counts = (record) => Object.entries(record).sort(([a], [b]) => Number(a) - Number(b)).map(([value, count]) => `${value}:${count}`).join(' ');
const share = (record) => Object.entries(record).sort(([, a], [, b]) => b - a).map(([type, count]) => `${type} ${count}`).join(', ');

function printGen(summary) {
	const { tiers } = summary;
	print(`${summary.failedMaps.length} seeds made no map${summary.failedMaps.length ? ` (${summary.failedMaps.join(', ')})` : ''}; the stops stage recorded ${summary.stopFailures} shortfalls and thinned ${summary.thinned} stops for daylight`);
	print('');
	print('tier  routes  band  stops a route    in band  below  fights a route  no fight  floor met  empty stops  hours  past dark');
	for (const row of tiers) {
		print(`${String(row.tier).padStart(4)}  ${String(row.routes).padStart(6)}  ${`${row.band.stops.min}-${row.band.stops.max}`.padStart(4)}  ${spreadText(row.stops).padEnd(15)}  ${percent(row.inBand.rate).padStart(7)}  ${percent(row.belowBand.rate).padStart(5)}  ${spreadText(row.fights, 2).padEnd(14)}  ${percent(row.noFight.rate).padStart(8)}  ${percent(row.fightFloorMet.rate).padStart(9)}  ${percent(row.empty.rate).padStart(11)}  ${fixed(row.hours).padStart(5)}  ${percent(row.pastDark.rate).padStart(9)}`);
	}
	print('');
	print("own road, legs no other POI's routes use; neighbor, the POI sharing the most road, its worst run for this route");
	print('tier  own share  own stops     floor on own  half band on own  room for both  own is last leg  own room       last-leg room  no room  last-leg stops  neighbor clears  neighbor takes every fight');
	for (const row of tiers) {
		print(`${String(row.tier).padStart(4)}  ${percent(row.ownShare).padStart(9)}  ${spreadText(row.ownStops).padEnd(12)}  ${percent(row.floorOnOwnRoad.rate).padStart(12)}  ${percent(row.halfBandOnOwnRoad.rate).padStart(16)}  ${percent(row.ownRoomForBoth.rate).padStart(13)}  ${percent(row.ownIsLastLeg.rate).padStart(14)}  ${spreadText(row.ownCapacity).padEnd(13)}  ${spreadText(row.lastLegCapacity).padEnd(13)}  ${percent(row.lastLegNoRoom.rate).padStart(7)}  ${spreadText(row.lastLegStops).padEnd(14)}  ${percent(row.neighborCleared).padStart(15)}  ${percent(row.neighborTakesEveryFight.rate).padStart(26)}`);
	}
	print('');
	print('distributions: stops a route, fights a route, skulls');
	for (const row of tiers) print(`${String(row.tier).padStart(4)}  stops ${counts(row.stops.counts)}  |  fights ${counts(row.fights.counts)}  |  skulls ${counts(row.skulls.counts)}`);
	print('');
	print('stop types by tier, a stop on two routes counted on each');
	for (const row of tiers) print(`${String(row.tier).padStart(4)}  ${share(row.types)}`);
	print(`\nplaced with no resolver yet (a quiet stretch on the run): ${share(summary.unresolved) || 'none'}`);
}

if (!isMainThread) {
	const { mode, input } = workerData;
	const config = simConfig(input);
	const cells = MODES[mode].cells(config);
	parentPort.on('message', async (index) => parentPort.postMessage({ index, row: await MODES[mode].play({ config, cell: cells[index] }) }));
} else {
	await main();
}
