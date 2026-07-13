import { AppState, Platform } from 'react-native';
import getDevServer from 'react-native/Libraries/Core/Devtools/getDevServer';
import { connectToDevTools } from 'react-devtools-core';
import { startReactNativeDevTools } from './react-native-client.js';

declare const __DEV__: boolean;

const runtimeGlobal = globalThis as typeof globalThis & {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  __REACT_DEVTOOLS_PORT__?: number;
};

startReactNativeDevTools({
  isDev: __DEV__,
  platform: Platform.OS,
  version: Platform.constants?.reactNativeVersion,
  appState: AppState,
  getDevServer,
  globalObject: runtimeGlobal,
  connectToDevTools,
});
