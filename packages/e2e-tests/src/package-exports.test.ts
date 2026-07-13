import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.resolve(
  import.meta.dirname,
  '../../agent-react-devtools',
);

function runNode(args: string[]): string {
  const result = spawnSync(process.execPath, args, {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    timeout: 10_000,
  });

  if (result.error != null) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Node smoke check failed (${result.status}):\n${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function resolveReactNativeEntry(conditions: string[] = []): string {
  const output = runNode([
    ...conditions.map((condition) => `--conditions=${condition}`),
    '--input-type=module',
    '--eval',
    "console.log(import.meta.resolve('agent-react-devtools/react-native'))",
  ]);
  return fileURLToPath(output);
}

describe('published React Native package shape', () => {
  it('loads the Metro wrapper from CommonJS and appends the built bootstrap', () => {
    const output = runNode([
      '--eval',
      `const { withAgentReactDevTools } = require('agent-react-devtools/metro');
const config = withAgentReactDevTools({
  serializer: { getModulesRunBeforeMainModule: () => ['/existing-init.js'] },
});
console.log(JSON.stringify({
  exportType: typeof withAgentReactDevTools,
  modules: config.serializer.getModulesRunBeforeMainModule('/entry.js'),
}));`,
    ]);
    const result = JSON.parse(output) as {
      exportType: string;
      modules: string[];
    };

    expect(result.exportType).toBe('function');
    expect(result.modules).toEqual([
      '/existing-init.js',
      path.join(PACKAGE_DIR, 'dist/react-native.js'),
    ]);
  });

  it('resolves default and browser clients to the no-op entry', () => {
    const noOpPath = path.join(PACKAGE_DIR, 'dist/react-native-noop.js');
    expect(resolveReactNativeEntry()).toBe(noOpPath);
    expect(resolveReactNativeEntry(['browser'])).toBe(noOpPath);
  });

  it('resolves the React Native condition to the native bootstrap', () => {
    expect(resolveReactNativeEntry(['react-native'])).toBe(
      path.join(PACKAGE_DIR, 'dist/react-native.js'),
    );
  });
});
