const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
	entry: {
		main: './src/index.ts',
		'battle-simulator': './src/battle-simulator.ts'
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
		new HtmlWebpackPlugin({
			template: './public/index.html',
			favicon: './public/favicon.ico',
			chunks: ['main']
		}),
		new HtmlWebpackPlugin({
			template: './public/battle.html',
			filename: 'battle.html',
			chunks: ['battle-simulator']
		}),
		new CopyWebpackPlugin({
			patterns: [
				{
					from: './src/assets',
					to: 'assets',
				},
				{
					from: './src/renderer/game/data/cards.json',
					to: 'cards.json',
				},
			],
		}),
	],
};
