import { describe, expect, it, vi } from 'vitest';
import { startReactNativeDevTools } from '../react-native-client.js';

type StartOptions = Parameters<typeof startReactNativeDevTools>[0];

function createOptions(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    isDev: true,
    platform: 'ios',
    version: { major: 0, minor: 87, patch: 0 },
    appState: { currentState: 'active', isAvailable: true },
    getDevServer: () => ({
      bundleLoadedFromServer: true,
      url: 'http://192.168.1.23:8081/index.bundle?platform=ios',
    }),
    globalObject: { __REACT_DEVTOOLS_GLOBAL_HOOK__: {} },
    connectToDevTools: vi.fn(),
    ...overrides,
  };
}

describe('startReactNativeDevTools', () => {
  it('connects React Native 0.87 to the agent using the Metro host and DevTools port', () => {
    const connectToDevTools = vi.fn();

    startReactNativeDevTools(
      createOptions({
        version: { major: 0, minor: 87, patch: 0, prerelease: 'rc.0' },
        connectToDevTools,
      }),
    );

    expect(connectToDevTools).toHaveBeenCalledOnce();
    expect(connectToDevTools).toHaveBeenCalledWith({
      host: '192.168.1.23',
      port: 8097,
      isAppActive: expect.any(Function),
    });
  });

  it('leaves React Native versions before 0.87 on their built-in connection', () => {
    const connectToDevTools = vi.fn();

    startReactNativeDevTools(
      createOptions({
        version: { major: 0, minor: 86, patch: 9 },
        connectToDevTools,
      }),
    );

    expect(connectToDevTools).not.toHaveBeenCalled();
  });

  it('does not connect in production', () => {
    const connectToDevTools = vi.fn();
    startReactNativeDevTools(createOptions({ isDev: false, connectToDevTools }));
    expect(connectToDevTools).not.toHaveBeenCalled();
  });

  it('does not connect on React Native Web', () => {
    const connectToDevTools = vi.fn();
    startReactNativeDevTools(
      createOptions({ platform: 'web', connectToDevTools }),
    );
    expect(connectToDevTools).not.toHaveBeenCalled();
  });

  it('fails safely when React Native has not initialized the DevTools hook', () => {
    const connectToDevTools = vi.fn();
    const warn = vi.fn();

    startReactNativeDevTools(
      createOptions({ globalObject: {}, connectToDevTools, warn }),
    );

    expect(connectToDevTools).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DevTools hook is unavailable'),
    );
  });

  it('does not create a second connection when the bootstrap runs again', () => {
    const connectToDevTools = vi.fn();
    const options = createOptions({ connectToDevTools });

    startReactNativeDevTools(options);
    startReactNativeDevTools(options);

    expect(connectToDevTools).toHaveBeenCalledOnce();
  });

  it('falls back to localhost when Metro does not provide a valid server URL', () => {
    const connectToDevTools = vi.fn();

    expect(() =>
      startReactNativeDevTools(
        createOptions({
          getDevServer: () => ({
            bundleLoadedFromServer: true,
            url: 'not a URL',
          }),
          connectToDevTools,
        }),
      ),
    ).not.toThrow();

    expect(connectToDevTools).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost' }),
    );
  });

  it('does not block application startup when the connection cannot start', () => {
    const warn = vi.fn();

    expect(() =>
      startReactNativeDevTools(
        createOptions({
          connectToDevTools: () => {
            throw new Error('WebSocket is unavailable');
          },
          warn,
        }),
      ),
    ).not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not start'),
    );
  });

  it('lets the backend defer connection while AppState reports background', () => {
    const connectToDevTools = vi.fn();
    const appState = { currentState: 'background', isAvailable: true };

    startReactNativeDevTools(
      createOptions({
        appState,
        globalObject: {
          __REACT_DEVTOOLS_GLOBAL_HOOK__: {},
          __REACT_DEVTOOLS_PORT__: 8098,
        },
        connectToDevTools,
      }),
    );

    const options = connectToDevTools.mock.calls[0][0];
    expect(options.port).toBe(8098);
    expect(options.isAppActive()).toBe(false);

    appState.isAvailable = false;
    expect(options.isAppActive()).toBe(true);
  });

  it('keeps IPv6 brackets when deriving the host from Metro', () => {
    const connectToDevTools = vi.fn();

    startReactNativeDevTools(
      createOptions({
        version: { major: 1, minor: 0, patch: 0 },
        getDevServer: () => ({
          bundleLoadedFromServer: true,
          url: 'http://[::1]:8081/index.bundle',
        }),
        connectToDevTools,
      }),
    );

    expect(connectToDevTools).toHaveBeenCalledWith(
      expect.objectContaining({ host: '[::1]' }),
    );
  });
});
