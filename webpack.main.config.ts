import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  entry: './src/main/index.ts',
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    '@discordjs/opus': 'commonjs2 @discordjs/opus',
    '@discordjs/voice': 'commonjs2 @discordjs/voice',
    'opusscript': 'commonjs2 opusscript',
    'sodium-native': 'commonjs2 sodium-native',
    'onnxruntime-node': 'commonjs2 onnxruntime-node',
    'zlib-sync': 'commonjs2 zlib-sync',
    'bufferutil': 'commonjs2 bufferutil',
    'utf-8-validate': 'commonjs2 utf-8-validate',
  },
};
