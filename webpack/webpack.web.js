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
	},
});
