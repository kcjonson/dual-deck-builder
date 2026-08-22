const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const devtool = process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-source-map';

// Main and preload are Node-side bundles; the renderer is the same web app
// as the browser build, emitted into dist/electron/renderer so its entry
// names can't collide with main.js/preload.js.
const mainConfig = {
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
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
		],
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
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
		],
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
};

const rendererConfig = merge(common, {
	mode,
	devtool,
	// contextIsolation is on and nodeIntegration off, so the renderer is a
	// plain web app; target 'web' keeps it identical to the browser build.
	target: 'web',
	output: {
		filename: '[name].[contenthash].js',
		path: path.resolve(__dirname, '../dist/electron/renderer'),
	},
	performance: {
		hints: false,
	},
});

module.exports = [mainConfig, preloadConfig, rendererConfig];
