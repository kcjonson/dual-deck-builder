const platformTimers = ['setTimeout', 'setInterval', 'requestAnimationFrame', 'clearTimeout', 'clearInterval', 'cancelAnimationFrame'];

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
			// R8.28: UI code takes time from the mount context's clock and
			// animator, never a platform timer, so pause, tests and the
			// screenshot harness control all of it. The frame loop and the
			// profiling code in engine/rendering and engine/debug are the
			// platform side and stay outside this list.
			files: [
				'src/renderer/engine/components/**/*.ts',
				'src/renderer/engine/ui/**/*.ts',
				'src/renderer/engine/animation/**/*.ts',
				'src/renderer/game/ui/**/*.ts',
				'src/renderer/game/screens/**/*.ts',
				'src/renderer/game/core/**/*.ts',
				'src/gallery/**/*.ts',
			],
			excludedFiles: ['**/*.test.ts'],
			rules: {
				'no-restricted-globals': ['error', ...platformTimers.map((name) => ({
					name,
					message: 'UI code takes time from context.clock and context.animator (R8.28).',
				}))],
				'no-restricted-properties': ['error', ...platformTimers.map((property) => ({
					object: 'window',
					property,
					message: 'UI code takes time from context.clock and context.animator (R8.28).',
				}))],
			},
		},
	],
};
