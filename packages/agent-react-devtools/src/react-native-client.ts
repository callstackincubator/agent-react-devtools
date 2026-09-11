const DEFAULT_DEVTOOLS_PORT = 8097;
const CONNECTION_STARTED_KEY = '__AGENT_REACT_DEVTOOLS_CONNECTION_STARTED__';

interface ReactNativeVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string | null;
}

interface AppStateLike {
  currentState?: string | null;
  isAvailable?: boolean;
}

interface DevServerInfo {
  bundleLoadedFromServer: boolean;
  url: string;
}

interface ReactNativeGlobal {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  __REACT_DEVTOOLS_PORT__?: number;
  [CONNECTION_STARTED_KEY]?: boolean;
}

interface ConnectOptions {
  host: string;
  port: number;
  isAppActive: () => boolean;
}

interface StartReactNativeDevToolsOptions {
  isDev: boolean;
  platform: string;
  version?: ReactNativeVersion | null;
  appState?: AppStateLike | null;
  getDevServer: () => DevServerInfo;
  globalObject: ReactNativeGlobal;
  connectToDevTools: (options: ConnectOptions) => void;
  warn?: (message: string) => void;
}

function getDevServerHost(getDevServer: () => DevServerInfo): string {
  try {
    const devServer = getDevServer();
    if (devServer.bundleLoadedFromServer) {
      const host = devServer.url.match(
        /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i,
      )?.[1];
      return host ?? 'localhost';
    }
  } catch {
    return 'localhost';
  }

  return 'localhost';
}

export function startReactNativeDevTools({
  appState,
  connectToDevTools,
  getDevServer,
  globalObject,
  isDev,
  platform,
  version,
  warn = console.warn,
}: StartReactNativeDevToolsOptions): void {
  if (
    !isDev ||
    platform === 'web' ||
    version == null ||
    (version.major === 0 && version.minor < 87) ||
    globalObject[CONNECTION_STARTED_KEY] === true
  ) {
    return;
  }

  if (globalObject.__REACT_DEVTOOLS_GLOBAL_HOOK__ == null) {
    warn(
      '[agent-react-devtools] React Native DevTools hook is unavailable; ' +
        'ensure the bootstrap runs after React Native initialization.',
    );
    return;
  }

  try {
    connectToDevTools({
      host: getDevServerHost(getDevServer),
      port: globalObject.__REACT_DEVTOOLS_PORT__ ?? DEFAULT_DEVTOOLS_PORT,
      isAppActive: () =>
        appState?.isAvailable === false ||
        appState?.currentState !== 'background',
    });

    globalObject[CONNECTION_STARTED_KEY] = true;
  } catch {
    warn(
      '[agent-react-devtools] React Native DevTools connection could not start.',
    );
  }
}
