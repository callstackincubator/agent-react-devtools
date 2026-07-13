import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectFramework, runInit, runUninit } from '../init.js';

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

  it('prints manual React Native 0.87 setup without modifying files', async () => {
    const packageJson = JSON.stringify({
      dependencies: { 'react-native': '^0.87.0' },
    });
    const metroConfig = `module.exports = { serializer: {} };\n`;
    const entry = `import { AppRegistry } from 'react-native';\n`;
    writeFileSync(join(dir, 'package.json'), packageJson);
    writeFileSync(join(dir, 'metro.config.js'), metroConfig);
    writeFileSync(join(dir, 'index.js'), entry);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runInit(dir, false);
      await runInit(dir, true);

      const output = log.mock.calls.flat().join('\n');
      expect(output).toContain('React Native 0.87+ requires manual setup');
      expect(output).toContain('npm install -D agent-react-devtools');
      expect(output).not.toContain('react-devtools-core');
      expect(output).toContain('withAgentReactDevTools');
      expect(output).toContain("import 'agent-react-devtools/react-native'");
      expect(output).not.toContain('connect to DevTools automatically');
    } finally {
      log.mockRestore();
    }

    expect(readFileSync(join(dir, 'package.json'), 'utf-8')).toBe(packageJson);
    expect(readFileSync(join(dir, 'metro.config.js'), 'utf-8')).toBe(metroConfig);
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

  it('explains that React Native manual setup has nothing to uninit', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native': '^0.87.0' } }),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runUninit(dir, false);
      const output = log.mock.calls.flat().join('\n');
      expect(output).toContain('manual setup');
      expect(output).toContain('no changes to remove');
      expect(output).not.toContain('configuration has been removed');
    } finally {
      log.mockRestore();
    }
  });
});
