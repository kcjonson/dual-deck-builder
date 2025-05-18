const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');

module.exports = merge(common, {
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
	devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-source-map',
	output: {
		filename: 'bundle.[contenthash].js',
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
