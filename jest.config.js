module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	moduleFileExtensions: ['ts', 'js'],
	testMatch: ['**/*.test.(ts|js)'],
	// The Playwright specs live in tests/ and are already unreachable twice over
	// (roots is src/, and they carry no .test. infix). This is the belt: the day
	// roots widens, jest must still not try to run a spec that needs a browser.
	testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/', '<rootDir>/dist/'],
	transform: {
		'^.+\\.(ts)$': 'ts-jest',
	},
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'\\.(glsl|vs|fs|vert|frag)$': '<rootDir>/src/__mocks__/glslMock.js',
	},
	collectCoverage: true,
	coverageDirectory: 'coverage',
	collectCoverageFrom: ['src/**/*.{js,ts}', '!src/**/*.d.ts', '!src/index.ts'],
	verbose: true,
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
