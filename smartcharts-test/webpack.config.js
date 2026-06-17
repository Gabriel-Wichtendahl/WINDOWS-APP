const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'app.js',
    publicPath: './',
    clean: true,
  },
  resolve: { extensions: ['.js'] },
  module: {
    rules: [
      { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: 'src/index.html', to: 'index.html' }],
    }),
  ],
  performance: { hints: false },
  devtool: false,
};
