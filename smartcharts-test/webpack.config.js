const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/index.jsx',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'app.js',
    publicPath: './',
    clean: true,
  },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { chrome: '120' } }],
              ['@babel/preset-react', { runtime: 'automatic' }]
            ]
          }
        }
      },
      { test: /\.css$/i, use: ['style-loader', 'css-loader'] }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/index.html', to: 'index.html' },
        {
          from: 'node_modules/@deriv/deriv-charts/dist',
          to: 'smartcharts-assets',
          globOptions: { ignore: ['**/smartcharts.js', '**/*.map'] }
        }
      ]
    })
  ],
  performance: { hints: false },
  devtool: false
};
