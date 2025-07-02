const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

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
