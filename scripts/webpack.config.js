var path = require('path')

module.exports = {
  target: 'web',
  context: path.join(__dirname, '../packages/babel-plugin-jsx'),
  entry: './src/index.ts',
  output: {
    path: path.join(__dirname, '../dist'),
    filename: 'babel-plugin-transform-vue-jsx-next.min.js',
    library: 'babel-plugin-transform-vue-jsx-next',
    libraryTarget: 'umd'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: {
          compilerOptions: { downlevelIteration: true },
        },
      },
      {
        test: /\.css$/,
        use: [
          'style-loader', 'css-loader',
        ],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
}