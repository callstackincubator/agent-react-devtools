import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectFramework, runInit, runUninit } from '../init.js';
import { withAgentReactDevTools } from '../metro-plugin.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ard-test-'));
}

describe('detectFramework', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects Vite via @vitejs/plugin-react', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { '@vitejs/plugin-react': '^4.0.0' } }),
    );
    expect(detectFramework(dir)).toBe('vite');
  });

  it('detects Next.js', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } }),
    );
    expect(detectFramework(dir)).toBe('nextjs');
  });

  it('detects CRA via react-scripts', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-scripts': '^5.0.0' } }),
    );
    expect(detectFramework(dir)).toBe('cra');
  });

  it('detects React Native', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native': '^0.72.0' } }),
    );
    expect(detectFramework(dir)).toBe('react-native');
  });

  it('returns unknown when no framework detected', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );
    expect(detectFramework(dir)).toBe('unknown');
  });

  it('returns unknown when no package.json', () => {
    expect(detectFramework(dir)).toBe('unknown');
  });
});

describe('runInit', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('patches vite.config.ts with plugin import and usage', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { '@vitejs/plugin-react': '^4.0.0' } }),
    );
    writeFileSync(
      join(dir, 'vite.config.ts'),
      `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`,
    );

    await runInit(dir, false);

    const content = readFileSync(join(dir, 'vite.config.ts'), 'utf-8');
    expect(content).toContain("import { reactDevtools } from 'agent-react-devtools/vite'");
    expect(content).toContain('reactDevtools(),');
  });

  it('dry-run does not modify files', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { '@vitejs/plugin-react': '^4.0.0' } }),
    );
    const original = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`;
    writeFileSync(join(dir, 'vite.config.ts'), original);

    await runInit(dir, true);

    const content = readFileSync(join(dir, 'vite.config.ts'), 'utf-8');
    expect(content).toBe(original);
  });

  it('patches Next.js App Router with use-client wrapper', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );
    mkdirSync(join(dir, 'app'));
    writeFileSync(
      join(dir, 'app/layout.tsx'),
      `export default function Layout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    );

    await runInit(dir, false);

    // Should create a 'use client' wrapper file
    const devtoolsPath = join(dir, 'app/devtools.ts');
    expect(existsSync(devtoolsPath)).toBe(true);
    const wrapper = readFileSync(devtoolsPath, 'utf-8');
    expect(wrapper).toContain("'use client'");
    expect(wrapper).toContain("agent-react-devtools/connect");

    // Layout should import the wrapper, not connect directly
    const layout = readFileSync(join(dir, 'app/layout.tsx'), 'utf-8');
    expect(layout).toMatch(/^import '\.\/devtools'/);
    expect(layout).not.toContain('agent-react-devtools/connect');
  });

  it('is idempotent for Next.js App Router', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );
    mkdirSync(join(dir, 'app'));
    writeFileSync(
      join(dir, 'app/layout.tsx'),
      `export default function Layout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    );

    await runInit(dir, false);
    const layoutAfterFirst = readFileSync(join(dir, 'app/layout.tsx'), 'utf-8');

    await runInit(dir, false);
    const layoutAfterSecond = readFileSync(join(dir, 'app/layout.tsx'), 'utf-8');

    expect(layoutAfterSecond).toBe(layoutAfterFirst);
  });

  it('patches Next.js Pages Router directly', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );
    mkdirSync(join(dir, 'pages'));
    writeFileSync(
      join(dir, 'pages/_app.tsx'),
      `export default function App({ Component, pageProps }) {\n  return <Component {...pageProps} />;\n}\n`,
    );

    await runInit(dir, false);

    const content = readFileSync(join(dir, 'pages/_app.tsx'), 'utf-8');
    expect(content).toMatch(/^import 'agent-react-devtools\/connect'/);
  });

  it('patches CRA src/index.tsx', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-scripts': '^5.0.0' } }),
    );
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'src/index.tsx'),
      `import React from 'react';\nimport ReactDOM from 'react-dom/client';\n`,
    );

    await runInit(dir, false);

    const content = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(content).toMatch(/^import 'agent-react-devtools\/connect'/);
  });

  it('skips if already configured', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { '@vitejs/plugin-react': '^4.0.0' } }),
    );
    const original = `import { reactDevtools } from 'agent-react-devtools/vite';\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({\n  plugins: [reactDevtools(), react()],\n});\n`;
    writeFileSync(join(dir, 'vite.config.ts'), original);

    await runInit(dir, false);

    const content = readFileSync(join(dir, 'vite.config.ts'), 'utf-8');
    expect(content).toBe(original);
  });

  it('patches a bare React Native Metro config and its reachable entry idempotently', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    const metroConfig = `module.exports = { serializer: {} };\n`;
    writeFileSync(join(dir, 'metro.config.js'), metroConfig);
    writeFileSync(join(dir, 'index.js'), `import { AppRegistry } from 'react-native';\n`);

    await runInit(dir, false);
    const configAfterFirstInit = readFileSync(join(dir, 'metro.config.js'), 'utf-8');
    const entryAfterFirstInit = readFileSync(join(dir, 'index.js'), 'utf-8');

    expect(configAfterFirstInit).toContain('@agent-react-devtools:metro-wrapper:start');
    expect(configAfterFirstInit).toContain('module.exports = withAgentReactDevTools(module.exports);');
    expect(entryAfterFirstInit).toContain('@agent-react-devtools:react-native-bootstrap');
    expect(entryAfterFirstInit).toContain("import 'agent-react-devtools/react-native';");

    await runInit(dir, false);
    expect(readFileSync(join(dir, 'metro.config.js'), 'utf-8')).toBe(configAfterFirstInit);
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).toBe(entryAfterFirstInit);
  });

  it('makes the native bootstrap reachable in the entry graph and schedules it after React Native initialization', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    writeFileSync(join(dir, 'index.js'), `export {};\n`);

    await runInit(dir, false);

    const entry = readFileSync(join(dir, 'index.js'), 'utf-8');
    const modules = withAgentReactDevTools({
      serializer: {
        getModulesRunBeforeMainModule: () => ['/react-native/InitializeCore.js'],
      },
    }).serializer.getModulesRunBeforeMainModule(join(dir, 'index.js'));

    expect(entry).toContain("import 'agent-react-devtools/react-native';");
    expect(modules[0]).toBe('/react-native/InitializeCore.js');
    expect(modules[1]).toMatch(/react-native\.js$/);
  });

  it('creates an Expo CommonJS Metro config in module packages and patches the router root layout', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      type: 'module',
      dependencies: { expo: '^54.0.0', 'expo-router': '^5.0.0' },
    }));
    mkdirSync(join(dir, 'app'));
    writeFileSync(join(dir, 'app/_layout.tsx'), `export default function Layout() { return null; }\n`);

    await runInit(dir, false);

    const configPath = join(dir, 'metro.config.cjs');
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, 'utf-8')).toContain("require('expo/metro-config')");
    expect(readFileSync(join(dir, 'app/_layout.tsx'), 'utf-8')).toContain(
      "import 'agent-react-devtools/react-native';",
    );
  });

  it('patches every platform entry when no shared React Native index exists', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    writeFileSync(join(dir, 'index.ios.js'), `export {};\n`);
    writeFileSync(join(dir, 'index.android.ts'), `export {};\n`);

    await runInit(dir, false);

    expect(readFileSync(join(dir, 'index.ios.js'), 'utf-8')).toContain('agent-react-devtools/react-native');
    expect(readFileSync(join(dir, 'index.android.ts'), 'utf-8')).toContain('agent-react-devtools/react-native');
  });

  it('uses a local package main entry before conventional entry files', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      main: './src/bootstrap.ts',
      dependencies: { 'react-native': '^0.87.0' },
    }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/bootstrap.ts'), `export {};\n`);
    writeFileSync(join(dir, 'index.js'), `export {};\n`);

    await runInit(dir, false);

    expect(readFileSync(join(dir, 'src/bootstrap.ts'), 'utf-8')).toContain('agent-react-devtools/react-native');
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).not.toContain('agent-react-devtools/react-native');
  });

  it('uses the nearest Metro config found by Metro’s upward search', async () => {
    const appDir = join(dir, 'app');
    mkdirSync(appDir);
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    writeFileSync(join(dir, 'metro.config.cjs'), `module.exports = {};\n`);
    writeFileSync(join(appDir, 'index.js'), `export {};\n`);

    await runInit(appDir, false);

    expect(readFileSync(join(dir, 'metro.config.cjs'), 'utf-8')).toContain('@agent-react-devtools:metro-wrapper:start');
    expect(readFileSync(join(appDir, 'index.js'), 'utf-8')).toContain('agent-react-devtools/react-native');
  });

  it('leaves a .js Metro config alone when package.json declares ESM', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      type: 'module',
      dependencies: { 'react-native': '^0.87.0' },
    }));
    const metroConfig = `export default {};\n`;
    const entry = `export {};\n`;
    writeFileSync(join(dir, 'metro.config.js'), metroConfig);
    writeFileSync(join(dir, 'index.js'), entry);

    await runInit(dir, false);

    expect(readFileSync(join(dir, 'metro.config.js'), 'utf-8')).toBe(metroConfig);
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).toBe(entry);
  });

  it('keeps unsupported Metro configs and entries unchanged', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    const metroConfig = `export default {};\n`;
    const entry = `export {};\n`;
    writeFileSync(join(dir, 'metro.config.mjs'), metroConfig);
    writeFileSync(join(dir, 'index.js'), entry);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runInit(dir, false);
      expect(log.mock.calls.flat().join('\n')).toContain('Manual setup required');
    } finally {
      log.mockRestore();
    }

    expect(readFileSync(join(dir, 'metro.config.mjs'), 'utf-8')).toBe(metroConfig);
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).toBe(entry);
  });

  it('preserves manual Metro wrapper setup while completing a missing entry import', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    const metroConfig = `const { withAgentReactDevTools } = require('agent-react-devtools/metro');\nmodule.exports = withAgentReactDevTools({});\n`;
    writeFileSync(join(dir, 'metro.config.js'), metroConfig);
    writeFileSync(join(dir, 'index.js'), `export {};\n`);

    await runInit(dir, false);

    expect(readFileSync(join(dir, 'metro.config.js'), 'utf-8')).toBe(metroConfig);
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).toContain('agent-react-devtools/react-native');
  });

  it('preflights React Native targets before a dry run writes any files', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    const entry = `export {};\n`;
    writeFileSync(join(dir, 'index.js'), entry);

    await runInit(dir, true);

    expect(existsSync(join(dir, 'metro.config.js'))).toBe(false);
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).toBe(entry);
  });
});

describe('runUninit', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes Vite plugin import and usage', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { '@vitejs/plugin-react': '^4.0.0' } }),
    );
    writeFileSync(
      join(dir, 'vite.config.ts'),
      `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`,
    );

    await runInit(dir, false);
    const afterInit = readFileSync(join(dir, 'vite.config.ts'), 'utf-8');
    expect(afterInit).toContain('agent-react-devtools');

    await runUninit(dir, false);
    const afterUninit = readFileSync(join(dir, 'vite.config.ts'), 'utf-8');
    expect(afterUninit).not.toContain('agent-react-devtools');
    expect(afterUninit).not.toContain('reactDevtools()');
    expect(afterUninit).toContain("import react from '@vitejs/plugin-react'");
  });

  it('removes CRA import', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-scripts': '^5.0.0' } }),
    );
    mkdirSync(join(dir, 'src'));
    const original = `import React from 'react';\nimport ReactDOM from 'react-dom/client';\n`;
    writeFileSync(join(dir, 'src/index.tsx'), original);

    await runInit(dir, false);
    const afterInit = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(afterInit).toContain('agent-react-devtools');

    await runUninit(dir, false);
    const afterUninit = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(afterUninit).not.toContain('agent-react-devtools');
    expect(afterUninit).toContain("import React from 'react'");
  });

  it('removes Next.js App Router wrapper and import', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );
    mkdirSync(join(dir, 'app'));
    writeFileSync(
      join(dir, 'app/layout.tsx'),
      `export default function Layout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`,
    );

    await runInit(dir, false);
    expect(existsSync(join(dir, 'app/devtools.ts'))).toBe(true);

    await runUninit(dir, false);
    expect(existsSync(join(dir, 'app/devtools.ts'))).toBe(false);
    const layout = readFileSync(join(dir, 'app/layout.tsx'), 'utf-8');
    expect(layout).not.toContain('devtools');
  });

  it('removes Next.js Pages Router import', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0' } }),
    );
    mkdirSync(join(dir, 'pages'));
    const original = `export default function App({ Component, pageProps }) {\n  return <Component {...pageProps} />;\n}\n`;
    writeFileSync(join(dir, 'pages/_app.tsx'), original);

    await runInit(dir, false);
    await runUninit(dir, false);

    const content = readFileSync(join(dir, 'pages/_app.tsx'), 'utf-8');
    expect(content).not.toContain('agent-react-devtools');
  });

  it('dry-run does not modify files', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-scripts': '^5.0.0' } }),
    );
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/index.tsx'), `import React from 'react';\n`);

    await runInit(dir, false);
    const afterInit = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');

    await runUninit(dir, true);
    const afterDryRun = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(afterDryRun).toBe(afterInit);
  });

  it('is a no-op when not configured', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-scripts': '^5.0.0' } }),
    );
    mkdirSync(join(dir, 'src'));
    const original = `import React from 'react';\n`;
    writeFileSync(join(dir, 'src/index.tsx'), original);

    await runUninit(dir, false);
    const content = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(content).toBe(original);
  });

  it('init -> uninit -> init roundtrip works', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-scripts': '^5.0.0' } }),
    );
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/index.tsx'), `import React from 'react';\n`);

    await runInit(dir, false);
    const afterInit1 = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(afterInit1).toContain('agent-react-devtools');

    await runUninit(dir, false);
    const afterUninit = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(afterUninit).not.toContain('agent-react-devtools');

    await runInit(dir, false);
    const afterInit2 = readFileSync(join(dir, 'src/index.tsx'), 'utf-8');
    expect(afterInit2).toContain('agent-react-devtools');
  });

  it('reverts only its marked React Native edits and deletes an unmodified generated config', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    const entry = `export {};\n`;
    writeFileSync(join(dir, 'index.js'), entry);

    await runInit(dir, false);
    await runUninit(dir, false);

    expect(existsSync(join(dir, 'metro.config.js'))).toBe(false);
    expect(readFileSync(join(dir, 'index.js'), 'utf-8')).toBe(entry);
  });

  it('keeps a modified generated Metro config while removing marked entry imports', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    }));
    writeFileSync(join(dir, 'index.js'), `export {};\n`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await runInit(dir, false);
      const configPath = join(dir, 'metro.config.js');
      writeFileSync(configPath, `${readFileSync(configPath, 'utf-8')}\n// user customization\n`);

      await runUninit(dir, false);

      expect(existsSync(configPath)).toBe(true);
      expect(warn.mock.calls.flat().join('\n')).toContain('leaving it in place');
      expect(readFileSync(join(dir, 'index.js'), 'utf-8')).not.toContain('agent-react-devtools/react-native');
    } finally {
      warn.mockRestore();
    }
  });
});
