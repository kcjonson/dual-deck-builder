/**
 * Two projects (DDB-536). `fast` is everything but map generation, and is what
 * `npm test` runs. `slow` is map generation's own tests, which regrow whole
 * maps and are about half the suite's time: `npm run test:slow`, and main's
 * CI runs them when anything they import changed, and nightly. A path or
 * `--changedSince` (`npm run test:changed`) runs both.
 */
const SLOW_ROOT = '<rootDir>/src/renderer/game/map';
// The same directory as an ignore pattern, which matches the absolute path with the platform's separators.
const SLOW_PATH = '[\\/]src[\\/]renderer[\\/]game[\\/]map[\\/]';

const shared = {
	testEnvironment: 'node',
	moduleFileExtensions: ['ts', 'js'],
	testMatch: ['**/*.test.(ts|js)'],
	// Transpile only (tsconfig.jest.json sets isolatedModules): `npm run typecheck`
	// already checks the tests' types, and checking them again per file was about
	// a quarter of the suite's time.
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
	},
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'\\.(glsl|vs|fs|vert|frag)$': '<rootDir>/src/__mocks__/glslMock.js',
		'\\.(png|ttf)$': '<rootDir>/src/__mocks__/assetMock.js',
		'/spawnMapWorker$': '<rootDir>/src/__mocks__/spawnMapWorkerMock.js',
	},
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};

module.exports = {
	// Coverage is opt-in (`npm run test:coverage`): instrumenting every run cost time and nothing read the report.
	coverageDirectory: 'coverage',
	collectCoverageFrom: ['src/**/*.{js,ts}', '!src/**/*.d.ts', '!src/index.ts'],
	verbose: true,
	projects: [
		{
			...shared,
			displayName: 'fast',
			// tests/smoke/support holds the boot smoke's save fixtures, checked here
			// against the real store; the smoke's specs carry no .test. infix and stay Playwright's.
			roots: ['<rootDir>/src', '<rootDir>/scripts', '<rootDir>/tests/smoke/support'],
			testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/', SLOW_PATH],
		},
		{
			...shared,
			displayName: 'slow',
			roots: [SLOW_ROOT],
		},
	],
};
