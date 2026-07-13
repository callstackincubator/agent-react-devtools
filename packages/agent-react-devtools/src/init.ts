import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

type Framework = 'vite' | 'nextjs' | 'cra' | 'react-native' | 'unknown';

export function detectFramework(cwd: string): Framework {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return 'unknown';

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (allDeps['@vitejs/plugin-react']) return 'vite';
  if (allDeps['next']) return 'nextjs';
  if (allDeps['react-scripts']) return 'cra';
  if (allDeps['react-native']) return 'react-native';
  return 'unknown';
}

function findFile(cwd: string, ...candidates: string[]): string | null {
  for (const c of candidates) {
    const p = join(cwd, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function prependImport(filePath: string, importLine: string, dryRun: boolean): string | null {
  const content = readFileSync(filePath, 'utf-8');
  if (content.includes(importLine) || content.includes('agent-react-devtools')) {
    return null; // already configured
  }
  const newContent = importLine + '\n' + content;
  if (!dryRun) {
    writeFileSync(filePath, newContent, 'utf-8');
  }
  return filePath;
}

function removeImport(filePath: string, importLine: string, dryRun: boolean): string | null {
  const content = readFileSync(filePath, 'utf-8');
  if (!content.includes(importLine)) {
    return null; // not configured
  }
  const newContent = content
    .split('\n')
    .filter((line) => line !== importLine)
    .join('\n');
  if (!dryRun) {
    writeFileSync(filePath, newContent, 'utf-8');
  }
  return filePath;
}

function patchViteConfig(cwd: string, dryRun: boolean): string[] {
  const configPath = findFile(
    cwd,
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mts',
    'vite.config.mjs',
  );
  if (!configPath) {
    console.error('  Could not find vite.config.{ts,js}');
    return [];
  }

  const content = readFileSync(configPath, 'utf-8');
  if (content.includes('agent-react-devtools')) {
    console.log('  Already configured');
    return [];
  }

  const importLine = "import { reactDevtools } from 'agent-react-devtools/vite';";
  let newContent: string;

  // Add import after the last existing import
  const lastImportIdx = content.lastIndexOf('\nimport ');
  if (lastImportIdx !== -1) {
    const endOfLine = content.indexOf('\n', lastImportIdx + 1);
    newContent =
      content.slice(0, endOfLine + 1) +
      importLine +
      '\n' +
      content.slice(endOfLine + 1);
  } else {
    newContent = importLine + '\n' + content;
  }

  // Add reactDevtools() to plugins array
  const pluginsMatch = newContent.match(/plugins\s*:\s*\[/);
  if (pluginsMatch && pluginsMatch.index != null) {
    const insertPos = pluginsMatch.index + pluginsMatch[0].length;
    newContent =
      newContent.slice(0, insertPos) +
      '\n    reactDevtools(),' +
      newContent.slice(insertPos);
  } else {
    console.error('  Could not find plugins array in vite config');
    return [];
  }

  if (!dryRun) {
    writeFileSync(configPath, newContent, 'utf-8');
  }

  return [configPath];
}

function patchNextJs(cwd: string, dryRun: boolean): string[] {
  // Try Pages Router first — _app is always client-side
  const pagesEntry = findFile(
    cwd,
    'pages/_app.tsx',
    'pages/_app.jsx',
    'pages/_app.js',
    'src/pages/_app.tsx',
    'src/pages/_app.jsx',
    'src/pages/_app.js',
  );
  if (pagesEntry) {
    const result = prependImport(
      pagesEntry,
      "import 'agent-react-devtools/connect';",
      dryRun,
    );
    return result ? [result] : [];
  }

  // App Router — layout is a Server Component, so we need a 'use client' wrapper
  const layoutPath = findFile(
    cwd,
    'app/layout.tsx',
    'app/layout.jsx',
    'app/layout.js',
    'src/app/layout.tsx',
    'src/app/layout.jsx',
    'src/app/layout.js',
  );
  if (!layoutPath) {
    console.error('  Could not find app/layout.tsx or pages/_app.tsx');
    return [];
  }

  const devtoolsPath = join(dirname(layoutPath), 'devtools.ts');
  const modified: string[] = [];

  // Create the 'use client' wrapper file
  if (existsSync(devtoolsPath)) {
    const existing = readFileSync(devtoolsPath, 'utf-8');
    if (!existing.includes('agent-react-devtools')) {
      console.error(`  ${devtoolsPath} already exists with different content`);
      return [];
    }
  } else {
    const wrapper = "'use client';\nimport 'agent-react-devtools/connect';\n";
    if (!dryRun) {
      writeFileSync(devtoolsPath, wrapper, 'utf-8');
    }
    modified.push(devtoolsPath);
  }

  // Prepend import of the wrapper to the layout
  const result = prependImport(layoutPath, "import './devtools';", dryRun);
  if (result) {
    modified.push(result);
  }

  return modified;
}

function patchCRA(cwd: string, dryRun: boolean): string[] {
  const entryPath = findFile(
    cwd,
    'src/index.tsx',
    'src/index.jsx',
    'src/index.js',
  );
  if (!entryPath) {
    console.error('  Could not find src/index.tsx');
    return [];
  }

  const result = prependImport(
    entryPath,
    "import 'agent-react-devtools/connect';",
    dryRun,
  );
  return result ? [result] : [];
}

function unpatchViteConfig(cwd: string, dryRun: boolean): string[] {
  const configPath = findFile(
    cwd,
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mts',
    'vite.config.mjs',
  );
  if (!configPath) return [];

  const content = readFileSync(configPath, 'utf-8');
  if (!content.includes('agent-react-devtools')) return [];

  let newContent = content
    .split('\n')
    .filter((line) => line !== "import { reactDevtools } from 'agent-react-devtools/vite';")
    .join('\n');

  // Remove reactDevtools() call from plugins array (with optional trailing comma)
  newContent = newContent.replace(/\s*reactDevtools\(\),?/g, '');

  if (!dryRun) {
    writeFileSync(configPath, newContent, 'utf-8');
  }
  return [configPath];
}

function unpatchNextJs(cwd: string, dryRun: boolean): string[] {
  const modified: string[] = [];

  // Remove the devtools.ts wrapper file if it exists and is ours
  const layoutPath = findFile(
    cwd,
    'app/layout.tsx',
    'app/layout.jsx',
    'app/layout.js',
    'src/app/layout.tsx',
    'src/app/layout.jsx',
    'src/app/layout.js',
  );

  if (layoutPath) {
    const devtoolsPath = join(dirname(layoutPath), 'devtools.ts');
    let devtoolsIsOurs = false;
    if (existsSync(devtoolsPath)) {
      const content = readFileSync(devtoolsPath, 'utf-8');
      if (content.includes('agent-react-devtools')) {
        devtoolsIsOurs = true;
        if (!dryRun) {
          unlinkSync(devtoolsPath);
        }
        modified.push(devtoolsPath);
      }
    }

    // Only remove the layout import if we confirmed devtools.ts was created by us,
    // to avoid corrupting a pre-existing import './devtools' that we don't own.
    if (devtoolsIsOurs) {
      const layoutContent = readFileSync(layoutPath, 'utf-8');
      const newContent = layoutContent
        .split('\n')
        .filter((line) => line !== "import './devtools';")
        .join('\n');
      if (newContent !== layoutContent) {
        if (!dryRun) {
          writeFileSync(layoutPath, newContent, 'utf-8');
        }
        modified.push(layoutPath);
      }
    }
  }

  // Also check Pages Router
  const pagesEntry = findFile(
    cwd,
    'pages/_app.tsx',
    'pages/_app.jsx',
    'pages/_app.js',
    'src/pages/_app.tsx',
    'src/pages/_app.jsx',
    'src/pages/_app.js',
  );
  if (pagesEntry) {
    const result = removeImport(pagesEntry, "import 'agent-react-devtools/connect';", dryRun);
    if (result) modified.push(result);
  }

  return modified;
}

function unpatchCRA(cwd: string, dryRun: boolean): string[] {
  const entryPath = findFile(
    cwd,
    'src/index.tsx',
    'src/index.jsx',
    'src/index.js',
  );
  if (!entryPath) return [];

  const result = removeImport(entryPath, "import 'agent-react-devtools/connect';", dryRun);
  return result ? [result] : [];
}

export async function runUninit(
  cwd: string,
  dryRun: boolean,
): Promise<void> {
  const framework = detectFramework(cwd);

  console.log(`Detected framework: ${framework}`);

  if (framework === 'unknown') {
    console.log('\nCould not detect framework. Manual removal required:');
    console.log("  Remove any `import 'agent-react-devtools/connect'` lines");
    return;
  }

  if (framework === 'react-native') {
    console.log(
      '\nReact Native init only prints manual setup; no changes to remove.',
    );
    return;
  }

  let modified: string[] = [];

  if (dryRun) {
    console.log('\n[dry-run] Would modify:');
  }

  switch (framework) {
    case 'vite':
      modified = unpatchViteConfig(cwd, dryRun);
      break;
    case 'nextjs':
      modified = unpatchNextJs(cwd, dryRun);
      break;
    case 'cra':
      modified = unpatchCRA(cwd, dryRun);
      break;
  }

  if (modified.length === 0) {
    console.log('  No changes needed (not configured or already removed)');
    return;
  }

  for (const f of modified) {
    console.log(`  ${dryRun ? '[dry-run] ' : ''}Reverted: ${f}`);
  }

  console.log('\nDone! agent-react-devtools configuration has been removed.');
}

export async function runInit(
  cwd: string,
  dryRun: boolean,
): Promise<void> {
  const framework = detectFramework(cwd);

  console.log(`Detected framework: ${framework}`);

  if (framework === 'unknown') {
    console.log('\nCould not detect framework. Manual setup required:');
    console.log("  import 'agent-react-devtools/connect';");
    console.log('  // Must be imported before React loads');
    return;
  }

  if (framework === 'react-native') {
    console.log('\nReact Native 0.87+ requires manual setup.');
    console.log('No files were changed by init.\n');
    console.log('1. Install compatible dependencies:');
    console.log(
      '   npm install -D agent-react-devtools react-devtools-core@^6.1.5\n',
    );
    console.log('2. Wrap your final Metro config:');
    console.log(
      "   const { withAgentReactDevTools } = require('agent-react-devtools/metro');",
    );
    console.log('   module.exports = withAgentReactDevTools(config);\n');
    console.log('3. Import the bootstrap from your entry graph:');
    console.log("   import 'agent-react-devtools/react-native';\n");
    console.log('Next steps:');
    console.log('  1. Start the daemon: agent-react-devtools start');
    console.log('  2. Start Metro and your app');
    return;
  }

  let modified: string[] = [];

  if (dryRun) {
    console.log('\n[dry-run] Would modify:');
  }

  switch (framework) {
    case 'vite':
      modified = patchViteConfig(cwd, dryRun);
      break;
    case 'nextjs':
      modified = patchNextJs(cwd, dryRun);
      break;
    case 'cra':
      modified = patchCRA(cwd, dryRun);
      break;
  }

  if (modified.length === 0) {
    console.log('  No changes needed (already configured or could not find entry files)');
    return;
  }

  for (const f of modified) {
    console.log(`  ${dryRun ? '[dry-run] ' : ''}Modified: ${f}`);
  }

  console.log('\nNext steps:');
  console.log('  1. Install: npm install -D agent-react-devtools react-devtools-core');
  console.log('  2. Start daemon: agent-react-devtools start');
  console.log('  3. Start dev server and open your app');
  console.log('  4. Inspect: agent-react-devtools get tree');
}
