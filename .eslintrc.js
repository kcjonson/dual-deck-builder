const platformTimers = ['setTimeout', 'setInterval', 'requestAnimationFrame', 'clearTimeout', 'clearInterval', 'cancelAnimationFrame'];
const timeMessage = 'UI code takes time from context.clock and context.animator (R8.17, R8.28).';

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
			files: [
				'src/renderer/engine/animation/**/*.ts',
				'src/renderer/engine/components/**/*.ts',
				'src/renderer/engine/coords/**/*.ts',
				'src/renderer/engine/draw/**/*.ts',
				'src/renderer/engine/input/**/*.ts',
				'src/renderer/engine/text/**/*.ts',
				'src/renderer/engine/theme/**/*.ts',
				'src/renderer/engine/ui/**/*.ts',
				'src/renderer/game/*.ts',
				'src/renderer/game/core/**/*.ts',
				'src/renderer/game/screens/**/*.ts',
				'src/renderer/game/ui/**/*.ts',
				'src/gallery/**/*.ts',
			],
			excludedFiles: ['**/*.test.ts'],
			rules: {
				'no-restricted-globals': ['error', ...platformTimers.map((name) => ({ name, message: timeMessage }))],
				'no-restricted-properties': ['error',
					...['window', 'globalThis', 'self'].flatMap((object) => platformTimers.map((property) => ({
						object,
						property,
						message: timeMessage,
					}))),
					{ object: 'Date', property: 'now', message: timeMessage },
					{ object: 'performance', property: 'now', message: timeMessage },
					{ object: 'window', property: 'performance', message: timeMessage },
				],
			},
		},
	],
};
