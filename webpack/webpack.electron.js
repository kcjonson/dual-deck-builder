const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-source-map',
  target: 'electron-renderer',
  entry: {
    main: './electron/main.ts',
    preload: './electron/preload.ts',
    renderer: './src/index.ts',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, '../dist/electron'),
    clean: true,
  },
  // Ensure hidden source maps are configured for electron
  node: {
    __dirname: false,
    __filename: false,
  },
  performance: {
    hints: false
  },
});
