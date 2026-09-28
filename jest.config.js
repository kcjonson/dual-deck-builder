module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	// tests/visual/support holds the screenshot harness's pure helpers, whose
	// unit tests run here with everything else rather than inside a browser.
	roots: ['<rootDir>/src', '<rootDir>/scripts', '<rootDir>/tests/visual/support'],
	moduleFileExtensions: ['ts', 'js'],
	testMatch: ['**/*.test.(ts|js)'],
	// The Playwright specs live in tests/ and are already unreachable twice over
	// (the only root under tests/ is the support directory, and specs carry no
	// .test. infix). This is the belt: jest must never try to run a spec that
	// needs a browser, so everything under tests/ except that directory stays out.
	testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/(?!visual/support/)', '<rootDir>/dist/'],
	transform: {
		'^.+\\.(ts)$': 'ts-jest',
	},
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'\\.(glsl|vs|fs|vert|frag)$': '<rootDir>/src/__mocks__/glslMock.js',
		'\\.png$': '<rootDir>/src/__mocks__/assetMock.js',
	},
	collectCoverage: true,
	coverageDirectory: 'coverage',
	collectCoverageFrom: ['src/**/*.{js,ts}', '!src/**/*.d.ts', '!src/index.ts'],
	verbose: true,
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
