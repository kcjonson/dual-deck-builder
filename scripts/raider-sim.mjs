/**
 * Headless raider encounter fights for tuning (DDB-462): every crew the
 * starting pool can send, each pair of different archetypes and each driver
 * alone, fresh and on their default decks, against each skull count's
 * encounter, with the game's own aggressive AI playing both sides. The
 * player side is a stand-in for a person, so read the rates as where a
 * fight sits, not as a promise.
 *
 *   node scripts/raider-sim.mjs [--fights 150] [--seed 1] [--routes 1,2,3]
 *     [--crews all] [--archetypes road_warrior,interceptor,mechanic]
 *     [--player-ai aggressive] [--turns 25] [--json results.json]
 *     [--set "spike_buggy.maxAdrenaline=7;road_gang=rust_buggy+rust_buggy"]
 *     [--log road_warrior+interceptor:2:7]
 *
 * --routes lists what each cell fights, comma separated: a skull count is
 * one fight, and `1+2` is a run's fights in order, each carrying the last
 * one's damage as the combat bridge writes it back (a driver who went down
 * revived at REVIVE_HP, a wreck limping on at LIMP_STRUCTURE). The combat
 * screen's skirmish fields the one-skull encounter, so a pair's 1 is its
 * row too. --crews takes `all`, `pairs`, `solo`, or a list like
 * `road_warrior+interceptor,mechanic`;
 * --archetypes defaults to the ones a new campaign can deal (unlocked in
 * DRIVER_CONFIGS). Run n of every cell draws from the same streams, off
 * --seed, and a pair swaps seats on every other run; the by-seat column
 * splits a pair's runs by who drives in seat 1. A fight still going
 * after --turns is a stall, which a player would have to abandon. --set
 * tries a tuning without editing the source. --log prints one fight's
 * battle log: crew, skull count, and run number.
 *
 * Like road-network.mjs, it transpiles the game modules it needs into a
 * temporary folder and runs them in a child process, clear of Jest.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const ENTRIES = [
	'src/renderer/game/mechanics/Battle.ts',
	'src/renderer/game/campaign/Encounters.ts',
	'src/renderer/game/campaign/CombatBridge.ts',
	'src/renderer/game/core/Rng.ts',
];

if (process.argv[2] !== '--built') {
	const { default: ts } = await import('typescript');
	const root = join(dirname(script), '..');
	const build = mkdtempSync(join(tmpdir(), 'raider-sim-'));
	// Every module the entries reach at runtime, type-only imports left out
	const pending = ENTRIES.map(entry => join(root, entry));
	const done = new Set();
	while (pending.length > 0) {
		const file = pending.pop();
		if (done.has(file)) continue;
		done.add(file);
		const target = join(build, relative(root, file)).replace(/\.ts$/, '.js');
		mkdirSync(dirname(target), { recursive: true });
		if (file.endsWith('.json')) {
			copyFileSync(file, target);
			continue;
		}
		const text = readFileSync(file, 'utf8');
		for (const [, typeOnly, specifier] of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
			if (typeOnly) continue;
			const base = resolve(dirname(file), specifier);
			const found = (base.endsWith('.json') ? [base] : [`${base}.ts`, join(base, 'index.ts')]).find(candidate => existsSync(candidate));
			if (found) pending.push(found);
		}
		const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true } });
		writeFileSync(target, outputText);
	}
	const child = spawnSync(process.execPath, [script, '--built', build, ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd() });
	rmSync(build, { recursive: true, force: true });
	process.exit(child.status ?? 1);
}

const build = process.argv[3];
const options = {};
for (let index = 4; index < process.argv.length; index += 2) options[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];

// Drivers log every draw, and the AIs think aloud
const print = (line = '') => process.stdout.write(`${line}\n`);
console.log = () => undefined;
console.info = () => undefined;
console.debug = () => undefined;
console.warn = () => undefined;

const load = createRequire(join(build, 'index.js'));
const game = (path) => load(`./src/renderer/game/${path}.js`);
const { Battle } = game('mechanics/Battle');
const { Card } = game('mechanics/Card');
const { Deck } = game('mechanics/Deck');
const { DRIVER_CONFIGS, Driver, DriverRole } = game('mechanics/Driver');
const { RAIDER_PROFILES } = game('mechanics/Raiders');
const { Team } = game('mechanics/Team');
const { TeamType } = game('mechanics/TeamType');
const { createDrivenVehicle } = game('mechanics/Vehicle');
const { ENCOUNTERS, encounterFor, encounterTeam } = game('campaign/Encounters');
const { LIMP_STRUCTURE, REVIVE_HP } = game('campaign/CombatBridge');
const { Rng } = game('core/Rng');
const cardsFile = JSON.parse(readFileSync(join(build, 'src/renderer/game/data/cards.json'), 'utf8'));

// --set: `;`-separated, each a raider profile field by path
// (`spike_buggy.skills.gunnery=9`, a deck as `spike_buggy.deck=ramming_speed:3+precision_shot:2`)
// or an encounter's raiders (`road_gang=rust_buggy+rust_buggy`)
for (const change of (options.set ?? '').split(';').filter(Boolean)) {
	const [path, value] = change.split('=');
	const keys = path.split('.');
	if (keys.length === 1) {
		ENCOUNTERS[path].raiders = value.split('+');
		continue;
	}
	const parent = keys.slice(0, -1).reduce((object, key) => object[key], RAIDER_PROFILES);
	const field = keys[keys.length - 1];
	parent[field] = field === 'deck'
		? Object.fromEntries(value.split('+').map(entry => entry.split(':')).map(([type, count]) => [type, Number(count)]))
		: Number.isNaN(Number(value)) ? value : Number(value);
}

const CARDS = new Map(cardsFile.cards.map(data => [data.type, new Card({ ...data, upgraded: false })]));
const FIGHTS = Number(options.fights ?? 150);
const SEED = Number(options.seed ?? 1);
const TURNS = Number(options.turns ?? 25);
const PLAYER_AI = options['player-ai'] ?? 'aggressive';
const ROUTES = (options.routes ?? '1,2,3').split(',').map(route => route.split('+').map(Number));
const ARCHETYPES = options.archetypes
	? options.archetypes.split(',')
	: Object.keys(DRIVER_CONFIGS).filter(archetype => DRIVER_CONFIGS[archetype].metadata.unlocked);

const SHORT = { road_warrior: 'RW', interceptor: 'Int', mechanic: 'Mech', raider: 'Raid' };
const crewName = (crew) => crew.map(archetype => SHORT[archetype] ?? archetype).join(' + ');

function crewsAsked() {
	const pairs = ARCHETYPES.flatMap((first, index) => ARCHETYPES.slice(index + 1).map(second => [first, second]));
	const solos = ARCHETYPES.map(archetype => [archetype]);
	switch (options.crews ?? 'all') {
		case 'all': return [...pairs, ...solos];
		case 'pairs': return pairs;
		case 'solo': return solos;
		default: return options.crews.split(',').map(crew => crew.split('+'));
	}
}

/**
 * A seat as the combat bridge deals it for a fight: the archetype's skills,
 * vehicle, and adrenaline, the default deck fresh, and the HP, structure,
 * and armor the seat carries in.
 */
function seatFor({ archetype, hitpoints, structure, armor }) {
	const config = DRIVER_CONFIGS[archetype];
	const deck = config.startingDeck.cards.flatMap(({ type, quantity }) => Array.from({ length: quantity }, () => CARDS.get(type).copy()));
	const driver = new Driver({
		archetype,
		metadata: { ...config.metadata },
		skills: { ...config.skills },
		vehicleStats: { ...config.vehicleStats },
		startingDeck: { cards: config.startingDeck.cards.map(entry => ({ ...entry })) },
		hitpoints,
		maxHitpoints: config.maxHitpoints,
		adrenaline: config.maxAdrenaline,
		maxAdrenaline: config.maxAdrenaline,
		handLimit: config.handLimit,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck(`${archetype}_deck`, `${archetype}'s deck`, deck),
	});
	return { driver, vehicle: createDrivenVehicle({ driver, structure, armor }) };
}

/** One fight, played out by the AIs on the stream given, against the skull count's encounter sized up as a run's stop does it. */
async function fight({ seats, skulls, rng }) {
	const vehicles = seats.map(seat => seat.vehicle);
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles }),
		enemyTeam: encounterTeam({ encounter: encounterFor(skulls), cards: CARDS, crewStructure: vehicles.map(vehicle => vehicle.structure) }),
		rng,
	});
	battle.aiController.setEnemyAI('aggressive');
	battle.aiController.setPlayerAI(PLAYER_AI);
	battle.start();
	while (!battle.isBattleOver() && battle.turn <= TURNS) {
		await battle.aiController.playPlayerCards();
		battle.endPlayerTurn();
	}
	return { battle, outcome: !battle.isBattleOver() ? 'stalled' : battle.isBattleWon() ? 'won' : 'lost' };
}

/**
 * A crew's run through a route's fights, fresh at the start, each won fight
 * written back as the bridge does. Seats swap on odd runs, and fight f of
 * run n draws from `fork('run', n).fork('fight', f)` off the seed.
 */
async function run({ crew, route, index }) {
	const order = crew.length === 2 && index % 2 === 1 ? [crew[1], crew[0]] : crew;
	const records = order.map(archetype => {
		const config = DRIVER_CONFIGS[archetype];
		return { archetype, hitpoints: config.maxHitpoints, structure: config.vehicleStats.maxStructure, armor: config.vehicleStats.armor };
	});
	const stream = new Rng({ seed: SEED }).fork('run', index);
	let down = false;
	let turns = 0;
	let last = null;
	for (const [stop, skulls] of route.entries()) {
		const seats = records.map(seatFor);
		last = await fight({ seats, skulls, rng: stream.fork('fight', stop) });
		turns += last.battle.turn;
		if (last.outcome !== 'won') return { outcome: last.outcome, battle: last.battle, firstSeat: order[0] };
		seats.forEach(({ driver, vehicle }, seat) => {
			down ||= !driver.isAlive();
			records[seat] = {
				...records[seat],
				hitpoints: driver.isAlive() ? driver.hitpoints : REVIVE_HP,
				structure: vehicle.isAlive() ? vehicle.structure : LIMP_STRUCTURE,
				armor: vehicle.armor,
			};
		});
	}
	const share = (lost, max) => records.reduce((sum, record) => sum + lost(record), 0) / records.reduce((sum, record) => sum + max(DRIVER_CONFIGS[record.archetype]), 0);
	return {
		outcome: 'home',
		battle: last.battle,
		firstSeat: order[0],
		turns,
		down,
		hpLost: share(record => DRIVER_CONFIGS[record.archetype].maxHitpoints - record.hitpoints, config => config.maxHitpoints),
		structureLost: share(record => DRIVER_CONFIGS[record.archetype].vehicleStats.maxStructure - record.structure, config => config.vehicleStats.maxStructure),
	};
}

const percent = (value) => (Number.isNaN(value) ? '-' : `${Math.round(value * 100)}%`).padStart(4);
const mean = (values) => values.length === 0 ? NaN : values.reduce((sum, value) => sum + value, 0) / values.length;
const routeName = (route) => route.join('+');

if (options.log) {
	const [crew, skulls, index] = options.log.split(':');
	const result = await run({ crew: crew.split('+'), route: [Number(skulls)], index: Number(index) });
	for (const { turn, type, message } of result.battle.getMessages()) {
		if (type !== 'debug') print(`${turn} ${type}: ${message}`);
	}
	print(`\n${result.outcome === 'home' ? `won, HP lost ${percent(result.hpLost)}, structure lost ${percent(result.structureLost)}` : result.outcome}`);
	process.exit(0);
}

const rows = [];
print(`${FIGHTS} runs a cell, seed ${SEED}, player AI ${PLAYER_AI}, stall after turn ${TURNS}`);
print('Encounters: ' + [1, 2, 3].map(skulls => `${skulls} ${ENCOUNTERS[encounterFor(skulls)].raiders.join(' + ')}`).join('; '));
print('');
print('crew          fights   won  by seat  stall  HP lost  struct lost  down  turns   (lost, down, and turns over runs won)');
for (const crew of crewsAsked()) {
	for (const route of ROUTES) {
		const results = [];
		for (let index = 0; index < FIGHTS; index += 1) results.push(await run({ crew, route, index }));
		const wins = results.filter(result => result.outcome === 'home');
		const wonWith = (archetype) => {
			const seated = results.filter(result => result.firstSeat === archetype);
			return seated.filter(result => result.outcome === 'home').length / seated.length;
		};
		const row = {
			crew: crew.join('+'),
			route: routeName(route),
			runs: FIGHTS,
			won: wins.length / FIGHTS,
			bySeat: crew.length === 2 ? crew.map(wonWith) : null,
			stall: results.filter(result => result.outcome === 'stalled').length / FIGHTS,
			hpLost: mean(wins.map(result => result.hpLost)),
			structureLost: mean(wins.map(result => result.structureLost)),
			down: wins.length === 0 ? NaN : wins.filter(result => result.down).length / wins.length,
			turns: mean(wins.map(result => result.turns)),
		};
		rows.push(row);
		const bySeat = row.bySeat ? row.bySeat.map(rate => String(Math.round(rate * 100))).join('/') : '';
		print(`${crewName(crew).padEnd(14)}${row.route.padStart(6)}  ${percent(row.won)}  ${bySeat.padStart(7)}  ${percent(row.stall).padStart(5)}  ${percent(row.hpLost).padStart(7)}  ${percent(row.structureLost).padStart(11)}  ${percent(row.down)}  ${(Number.isNaN(row.turns) ? '-' : row.turns.toFixed(1)).padStart(5)}`);
	}
}
if (options.json) writeFileSync(options.json, JSON.stringify({ runs: FIGHTS, seed: SEED, playerAI: PLAYER_AI, rows }, null, '\t'));
