const { merge } = require('webpack-merge');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const common = require('./webpack.common.js');

const isDevelopment = process.env.NODE_ENV !== 'production';

// The scene gallery is a development-only bundle entry (R15.37 and the chapter
// 13 backend mapping). It lives here rather than in webpack.common.js because
// webpack.electron.js merges common into the packaged renderer, and merge
// combines entry key-wise and concatenates plugins, so a spread guard here adds
// the entry and its page in development and emits neither in production.
// `npm run build:web` forces NODE_ENV=production and both deploy workflows call
// it, so no deployed artifact carries the gallery. The cost is that a Playwright
// run has to point at a development build.
const galleryEntry = isDevelopment ? { gallery: './src/gallery/index.ts' } : {};
const galleryPlugins = isDevelopment
	? [
		new HtmlWebpackPlugin({
			template: './public/gallery.html',
			filename: 'gallery.html',
			chunks: ['gallery'],
		}),
	]
	: [];

module.exports = merge(common, {
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
	devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-source-map',
	entry: galleryEntry,
	plugins: galleryPlugins,
	output: {
		filename: '[name].[contenthash].js',
		path: path.resolve(__dirname, '../dist/web'),
		clean: true,
	},
	devServer: {
		static: {
			directory: path.resolve(__dirname, '../public'),
		},
		hot: true,
		compress: true,
		port: 9000,
		// Cross-origin isolation, which buys two measurements that are otherwise
		// unavailable to chapter 13: performance.now() is coarsened to 100
		// microseconds without it, which is why every figure in the phase 0
		// baseline was a multiple of 0.1 ms and most section readings were 0, and
		// performance.measureUserAgentSpecificMemory only exists with it, which is
		// why memory.usedBytes was permanently null. Isolation costs nothing here
		// because nothing this app loads is cross-origin: every script, asset and
		// fetch is served by this same dev server. Development only, so a deployed
		// build is unaffected and its clock stays coarse; the numbers that matter
		// are captured against this server.
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
	},
});
