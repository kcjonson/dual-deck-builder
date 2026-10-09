const platformTimers = ['setTimeout', 'setInterval', 'requestAnimationFrame', 'clearTimeout', 'clearInterval', 'cancelAnimationFrame'];
const timeMessage = 'UI code takes time from context.clock and context.animator (R8.17, R8.28).';
const randomMessage = 'Game code takes randomness from a seeded Rng stream, rng.fork(name) (src/renderer/game/core/Rng.ts), so a seed replays exactly.';
const cryptoRandom = ['getRandomValues', 'randomUUID', 'randomInt', 'randomBytes', 'randomFill', 'randomFillSync'];

const timerProperties = [
	...['window', 'globalThis', 'self'].flatMap((object) => platformTimers.map((property) => ({
		object,
		property,
		message: timeMessage,
	}))),
	{ object: 'Date', property: 'now', message: timeMessage },
	{ object: 'performance', property: 'now', message: timeMessage },
	{ object: 'window', property: 'performance', message: timeMessage },
];
const randomProperties = [
	{ object: 'Math', property: 'random', message: randomMessage },
	// No object, so crypto, window.crypto, self.crypto, and a default
	// import of Node's crypto all match.
	...cryptoRandom.map((property) => ({ property, message: randomMessage })),
];
const approximatedMessage = 'Map generation regrows on load in any engine, so it uses only exactly rounded arithmetic: adds, multiplies, divides, square roots, and floors (terrain-erosion.md, Determinism).';
const approximatedMath = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh']
	.map((property) => ({ object: 'Math', property, message: approximatedMessage }));
// The game folders under the timer ban. The random ban covers them too, so
// they carry both property lists in the last override below.
const timedGameCode = [
	'src/renderer/game/*.ts',
	'src/renderer/game/core/**/*.ts',
	'src/renderer/game/screens/**/*.ts',
	'src/renderer/game/ui/**/*.ts',
];

module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
	},
	extends: [
		'plugin:@typescript-eslint/recommended',
	],
	plugins: ['@typescript-eslint'],
	rules: {
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'no-duplicate-case': 'error',
	},
	overrides: [
		{
			// R8.17 and R8.28: UI code takes time from the mount context's
			// clock and animator, never a platform timer or a wall-clock read,
			// so pause, tests and the screenshot harness control all of it.
			// The platform side is left out on purpose: engine/rendering
			// (FrameLoop's rAF, FrameTimer and GpuTimer's clocks), engine/debug
			// (perf capture, hitch observer), the entry points, and game
			// mechanics, whose log timestamps are data rather than timing.
			// A game folder joins through timedGameCode, never this list.
			files: [
				'src/renderer/engine/animation/**/*.ts',
				'src/renderer/engine/components/**/*.ts',
				'src/renderer/engine/coords/**/*.ts',
				'src/renderer/engine/draw/**/*.ts',
				'src/renderer/engine/input/**/*.ts',
				'src/renderer/engine/text/**/*.ts',
				'src/renderer/engine/theme/**/*.ts',
				'src/renderer/engine/ui/**/*.ts',
				...timedGameCode,
				'src/gallery/**/*.ts',
			],
			excludedFiles: ['**/*.test.ts'],
			rules: {
				'no-restricted-globals': ['error', ...platformTimers.map((name) => ({ name, message: timeMessage }))],
				'no-restricted-properties': ['error', ...timerProperties],
			},
		},
		{
			// Seeds and determinism (Area Map Generation, seeded-prng.md): a
			// map, a campaign, or a fight replays exactly from its seed, so
			// game code reads no unseeded source. Tests are covered too,
			// unlike the timer block, because a seed sweep drawn from
			// Math.random or Node's crypto makes a CI failure impossible to
			// replay. jest.spyOn(Math, 'random') isn't a member access, so a
			// test can still prove the game never calls it; keep that spy
			// around the call under test only, or mock its return values and
			// check the output doesn't move, since source-map-support can call
			// a spied Math.random while Jest formats a stack trace.
			//
			// The one sanctioned read is freshSeed() in core/Rng.ts, which
			// mints root seeds and carries its own disable. This rule can't see
			// randomness reached through an import; that code takes an Rng.
			files: ['src/renderer/game/**/*.ts'],
			rules: {
				'no-restricted-properties': ['error', ...randomProperties],
				// A named import is a bare call the property rule never sees.
				'no-restricted-imports': ['error', {
					paths: ['crypto', 'node:crypto'].map((name) => ({ name, importNames: cryptoRandom, message: randomMessage })),
				}],
			},
		},
		{
			// Options replace rather than merge across overrides, so the
			// random block above drops the timer list wherever both reach;
			// this entry puts both lists back for those folders.
			files: timedGameCode,
			excludedFiles: ['**/*.test.ts'],
			rules: {
				'no-restricted-properties': ['error', ...timerProperties, ...randomProperties],
			},
		},
		{
			// Seeds and determinism (Area Map Generation): the map regrows its
			// land on load, so everything generation computes has to come out
			// to the same bits in every engine. ECMAScript rounds adds,
			// multiplies, divides, and square roots exactly, but leaves these
			// functions, and the ** operator, to each engine's approximation
			// (terrain-erosion.md, Determinism). Tests check generation against
			// them freely, so they're left out. The random list rides along,
			// since options replace rather than merge.
			files: ['src/renderer/game/map/**/*.ts'],
			excludedFiles: ['**/*.test.ts'],
			rules: {
				'no-restricted-properties': ['error', ...randomProperties, ...approximatedMath],
				'no-restricted-syntax': ['error',
					{ selector: "BinaryExpression[operator='**']", message: approximatedMessage },
					{ selector: "AssignmentExpression[operator='**=']", message: approximatedMessage },
				],
			},
		},
	],
};
