const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const devtool = process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-source-map';

// Each compiler gets its own ts-loader program, and by default that program is
// everything tsconfig.json includes (all of src, tests too), about 900 MB of
// heap apiece. The renderer's program already type-checks all of it in this
// same process, so main and preload only compile what they bundle; three full
// programs at once ran the macOS runner out of heap.
const nodeSideTypeScriptRule = {
	test: /\.tsx?$/,
	loader: 'ts-loader',
	exclude: /node_modules/,
	options: { onlyCompileBundledFiles: true },
};

// Main and preload are Node-side bundles; the renderer is the same web app
// as the browser build, emitted into dist/electron/renderer so its entry
// names can't collide with main.js/preload.js.
const mainConfig = {
	name: 'main',
	mode,
	devtool,
	target: 'electron-main',
	entry: {
		main: './electron/main.ts',
	},
	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, '../dist/electron'),
	},
	module: {
		rules: [nodeSideTypeScriptRule],
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	node: {
		__dirname: false,
		__filename: false,
	},
};

const preloadConfig = {
	name: 'preload',
	mode,
	devtool,
	target: 'electron-preload',
	entry: {
		preload: './electron/preload.ts',
	},
	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, '../dist/electron'),
	},
	module: {
		rules: [nodeSideTypeScriptRule],
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
};

const rendererConfig = merge(common, {
	name: 'renderer',
	mode,
	devtool,
	// contextIsolation is on and nodeIntegration off, so the renderer is a
	// plain web app; target 'web' keeps it identical to the browser build.
	target: 'web',
	module: {
		rules: [
			// R15.34: a packaged page runs from file://, so atlas images and
			// the raster fallback's font files are inlined as data URIs and no
			// runtime file request exists.
			{
				test: /\.(png|ttf)$/,
				type: 'asset/inline',
			},
		],
	},
	output: {
		filename: '[name].[contenthash].js',
		path: path.resolve(__dirname, '../dist/electron/renderer'),
		// Renderer has its own directory, so clean is safe here; the shared
		// dist/electron root is cleared by the rimraf in the npm script.
		clean: true,
	},
	performance: {
		hints: false,
	},
});

module.exports = [mainConfig, preloadConfig, rendererConfig];
