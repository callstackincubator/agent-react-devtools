import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { withAgentReactDevTools } from '../metro-plugin.js';

describe('withAgentReactDevTools', () => {
  it('runs the React Native bootstrap after Metro pre-main modules', () => {
    const config = withAgentReactDevTools({
      serializer: {
        getModulesRunBeforeMainModule: () => ['/react-native/InitializeCore.js'],
      },
    });

    const modules = config.serializer.getModulesRunBeforeMainModule(
      '/app/index.js',
    );

    expect(modules[0]).toBe('/react-native/InitializeCore.js');
    expect(isAbsolute(modules[1])).toBe(true);
    expect(modules[1]).toMatch(/react-native\.js$/);
  });

  it('does not add the bootstrap more than once', () => {
    const once = withAgentReactDevTools({ serializer: {} });
    const twice = withAgentReactDevTools(once);

    const modules = twice.serializer.getModulesRunBeforeMainModule(
      '/app/index.js',
    );

    expect(
      modules.filter((module) => /react-native\.js$/.test(module)),
    ).toHaveLength(1);
  });

  it('preserves the existing serializer callback context without mutating it', () => {
    const serializer = {
      marker: 'existing-serializer',
      getModulesRunBeforeMainModule(this: { marker: string }, entry: string) {
        expect(this).toBe(serializer);
        return [`${this.marker}:${entry}`];
      },
    };
    const originalCallback = serializer.getModulesRunBeforeMainModule;

    const wrapped = withAgentReactDevTools({ serializer });
    const modules =
      wrapped.serializer.getModulesRunBeforeMainModule('/entry.js');

    expect(wrapped.serializer).not.toBe(serializer);
    expect(serializer.getModulesRunBeforeMainModule).toBe(originalCallback);
    expect(modules[0]).toBe('existing-serializer:/entry.js');
  });

  it('wraps Metro config factories without changing their arguments or serializer hooks', () => {
    const factory = (projectRoot: string) => ({
      projectRoot,
      serializer: {
        getModulesRunBeforeMainModule: () => ['/react-native/InitializeCore.js'],
      },
    });

    const wrapped = withAgentReactDevTools(factory);
    const config = wrapped('/app');

    expect(config.projectRoot).toBe('/app');
    expect(config.serializer.getModulesRunBeforeMainModule('/app/index.js')).toEqual([
      '/react-native/InitializeCore.js',
      expect.stringMatching(/react-native\.js$/),
    ]);
  });

  it('wraps async and promise Metro config exports', async () => {
    const asyncFactory = async () => ({ serializer: {} });
    const promisedConfig = Promise.resolve({ serializer: {} });

    const fromFactory = await withAgentReactDevTools(asyncFactory)();
    const fromPromise = await withAgentReactDevTools(promisedConfig);

    expect(fromFactory.serializer.getModulesRunBeforeMainModule('/app/index.js')).toHaveLength(1);
    expect(fromPromise.serializer.getModulesRunBeforeMainModule('/app/index.js')).toHaveLength(1);
  });
});

describe('React Native package exports', () => {
  it('publishes Metro for import and require plus the native bootstrap', () => {
    expect(packageJson.exports).toMatchObject({
      './metro': {
        types: './dist/metro.d.ts',
        import: './dist/metro.js',
        require: './dist/metro.cjs',
      },
      './react-native': {
        types: './dist/react-native.d.ts',
        browser: './dist/react-native-noop.js',
        'react-native': './dist/react-native.js',
        default: './dist/react-native-noop.js',
      },
    });
  });
});
