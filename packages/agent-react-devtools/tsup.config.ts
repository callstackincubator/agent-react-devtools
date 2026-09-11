import { defineConfig } from 'tsup';

export default defineConfig([
  // Node CLI entries (cli + daemon) — with shebang
  {
    entry: {
      cli: 'src/cli.ts',
      daemon: 'src/daemon.ts',
    },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    splitting: true,
    clean: true,
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Browser entry — connect script
  {
    entry: {
      connect: 'src/connect.ts',
    },
    format: ['esm'],
    target: 'esnext',
    platform: 'browser',
    dts: true,
    sourcemap: true,
    external: ['react-devtools-core'],
  },
  // Node entry — Vite plugin (no shebang)
  {
    entry: {
      vite: 'src/vite-plugin.ts',
    },
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    dts: true,
    sourcemap: true,
    external: ['vite'],
  },
  // Node entry — Metro config wrapper (ESM + CommonJS)
  {
    entry: {
      metro: 'src/metro-plugin.ts',
    },
    format: ['esm', 'cjs'],
    target: 'node18',
    platform: 'node',
    dts: true,
    sourcemap: true,
    shims: true,
  },
  // React Native client entries — transformed by Metro in the consuming app
  {
    entry: {
      'react-native': 'src/react-native.ts',
      'react-native-noop': 'src/react-native-noop.ts',
    },
    format: ['esm'],
    target: 'es2019',
    platform: 'neutral',
    dts: true,
    sourcemap: true,
    external: ['react-native', 'react-devtools-core'],
  },
]);
