const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { execSync } = require('child_process');

const isProduction = process.env.NODE_ENV === 'production';

// The main menu's build stamp. Null outside production so the dev server, and
// the screenshot harness that runs on it, never render a per-commit value.
function resolveBuildSha() {
	if (!isProduction) return null;
	if (process.env.BUILD_SHA) return process.env.BUILD_SHA.slice(0, 7);
	try {
		const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
		return sha.slice(0, 7) || null;
	} catch {
		return null;
	}
}

function resolveBuildNumber() {
	if (!isProduction) return null;
	return process.env.BUILD_NUMBER || null;
}

module.exports = {
	entry: {
		main: './src/index.ts',
		'battle-simulator': './src/battle-simulator.ts',
		'ai-evaluator': './src/ai-evaluator.ts'
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
			{
				test: /\.(glsl|vs|fs|vert|frag)$/,
				use: 'raw-loader',
			},
		],
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
		alias: {
			'@': path.resolve(__dirname, '../src'),
		},
	},
	optimization: {
		splitChunks: {
			chunks: 'all',
		},
	},
	plugins: [
		// Dev tooling (window.__ui and friends) is wrapped in `if (__DEV_TOOLS__)`
		// so a production build folds the constant to false and drops the code.
		// Lives in common because webpack.electron.js merges this same config
		// into the renderer; a web-only define would be a ReferenceError there.
		new webpack.DefinePlugin({
			__DEV_TOOLS__: JSON.stringify(!isProduction),
			__BUILD_SHA__: JSON.stringify(resolveBuildSha()),
			__BUILD_NUMBER__: JSON.stringify(resolveBuildNumber()),
		}),
		new HtmlWebpackPlugin({
			template: './public/index.html',
			favicon: './public/favicon.ico',
			chunks: ['main']
		}),
		new HtmlWebpackPlugin({
			template: './public/battle.html',
			filename: 'battle.html',
			chunks: ['battle-simulator'],
			inject: 'body'
		}),
		new HtmlWebpackPlugin({
			template: './public/evalai.html',
			filename: 'evalai.html',
			chunks: ['ai-evaluator']
		}),
		new CopyWebpackPlugin({
			patterns: [
				{
					from: './src/assets',
					to: 'assets',
					// The atlases are bundled through imports (R15.34) and the
					// TTFs and charset are build inputs; only the licences ship
					// as files, below.
					globOptions: { ignore: ['**/fonts/**'] },
				},
				{
					from: 'fonts/*/OFL.txt',
					context: './src/assets',
					to: 'assets',
				},
				{
					// The icon font's Apache 2.0 licence, which the atlas carries.
					from: 'fonts/*/LICENSE.txt',
					context: './src/assets',
					to: 'assets',
				},
				{
					from: './src/renderer/game/data/cards.json',
					to: 'cards.json',
				},
				{
					from: './public/evalai-ui.js',
					to: 'evalai-ui.js',
				},
				{
					from: './public/battle-simulator.js',
					to: 'battle-simulator.js',
				},
			],
		}),
	],
};
