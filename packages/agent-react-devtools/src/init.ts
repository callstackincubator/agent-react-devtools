import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, sep, extname } from 'node:path';

type Framework = 'vite' | 'nextjs' | 'cra' | 'react-native' | 'expo' | 'unknown';

interface PackageJson {
  type?: string;
  main?: string;
  metro?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NativeConfigPlan {
  path: string;
  content: string | null;
}

interface NativeSetupPlan {
  config: NativeConfigPlan;
  entries: string[];
}

const NATIVE_IMPORT_MARKER = '// @agent-react-devtools:react-native-bootstrap';
const NATIVE_IMPORT = "import 'agent-react-devtools/react-native';";
const METRO_WRAPPER_START = '// @agent-react-devtools:metro-wrapper:start';
const METRO_WRAPPER_END = '// @agent-react-devtools:metro-wrapper:end';
const GENERATED_METRO_MARKER = '// @agent-react-devtools:generated-metro-config';
const METRO_CONFIG_CANDIDATES = [
  'metro.config.js',
  'metro.config.cjs',
  'metro.config.mjs',
  'metro.config.ts',
  'metro.config.json',
];
const SOURCE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx'];
const PLATFORM_SUFFIXES = ['ios', 'android', 'native'];

function readPackageJson(cwd: string): PackageJson | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;
  return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
}

export function detectFramework(cwd: string): Framework {
  const pkg = readPackageJson(cwd);
  if (!pkg) return 'unknown';
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (allDeps['@vitejs/plugin-react']) return 'vite';
  if (allDeps['next']) return 'nextjs';
  if (allDeps['react-scripts']) return 'cra';
  if (allDeps['expo']) return 'expo';
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

function nativeMetroWrapperBlock(): string {
  return `\n${METRO_WRAPPER_START}\nconst { withAgentReactDevTools } = require('agent-react-devtools/metro');\nmodule.exports = withAgentReactDevTools(module.exports);\n${METRO_WRAPPER_END}\n`;
}

function generatedMetroConfig(isExpo: boolean): string {
  const metroPackage = isExpo ? 'expo/metro-config' : '@react-native/metro-config';
  return `${GENERATED_METRO_MARKER}\nconst { getDefaultConfig } = require('${metroPackage}');\nconst { withAgentReactDevTools } = require('agent-react-devtools/metro');\n\nconst config = getDefaultConfig(__dirname);\nmodule.exports = withAgentReactDevTools(config);\n`;
}

function sourceFile(cwd: string, stem: string): string | null {
  for (const extension of SOURCE_EXTENSIONS) {
    const path = join(cwd, `${stem}.${extension}`);
    if (existsSync(path)) return path;
  }
  return null;
}

function platformSourceFiles(cwd: string, stem: string): string[] {
  const paths: string[] = [];
  for (const platform of PLATFORM_SUFFIXES) {
    for (const extension of SOURCE_EXTENSIONS) {
      const path = join(cwd, `${stem}.${platform}.${extension}`);
      if (existsSync(path)) paths.push(path);
    }
  }
  return paths;
}

function resolvePackageMain(cwd: string, main: string | undefined): string | null {
  if (!main || main.startsWith('@') || (!main.startsWith('.') && main.includes('/'))) {
    return null;
  }

  const path = resolve(cwd, main);
  if (path !== cwd && !path.startsWith(`${cwd}${sep}`)) return null;
  if (existsSync(path)) return path;

  if (extname(path) === '') {
    for (const extension of SOURCE_EXTENSIONS) {
      const withExtension = `${path}.${extension}`;
      if (existsSync(withExtension)) return withExtension;
    }
  }

  return null;
}

function unique(paths: Array<string | null>): string[] {
  return [...new Set(paths.filter((path): path is string => path !== null))];
}

function findMetroConfigPaths(cwd: string): string[] {
  let directory = resolve(cwd);
  while (true) {
    const configs = METRO_CONFIG_CANDIDATES
      .map((candidate) => join(directory, candidate))
      .filter(existsSync);
    if (configs.length > 0) return configs;

    const parent = dirname(directory);
    if (parent === directory) return [];
    directory = parent;
  }
}

function findNativeEntryFiles(cwd: string, pkg: PackageJson, isExpo: boolean): string[] {
  const packageMain = resolvePackageMain(cwd, pkg.main);
  if (packageMain) return [packageMain];

  if (isExpo) {
    const routerLayout = findFile(
      cwd,
      ...SOURCE_EXTENSIONS.flatMap((extension) => [
        `app/_layout.${extension}`,
        `src/app/_layout.${extension}`,
      ]),
    );
    if (routerLayout) return [routerLayout];
  }

  const index = sourceFile(cwd, 'index');
  if (index) return [index];
  const platformIndexes = platformSourceFiles(cwd, 'index');
  if (platformIndexes.length > 0) return platformIndexes;

  if (isExpo) {
    const app = sourceFile(cwd, 'App');
    if (app) return [app];
    const platformApps = platformSourceFiles(cwd, 'App');
    if (platformApps.length > 0) return platformApps;
  }

  return [];
}

function findAllNativeEntryFiles(cwd: string, pkg: PackageJson): string[] {
  const packageMain = resolvePackageMain(cwd, pkg.main);
  const layouts = SOURCE_EXTENSIONS.flatMap((extension) => [
    join(cwd, `app/_layout.${extension}`),
    join(cwd, `src/app/_layout.${extension}`),
  ]).filter(existsSync);
  const roots = [sourceFile(cwd, 'index'), sourceFile(cwd, 'App')];
  return unique([
    packageMain,
    ...layouts,
    ...roots,
    ...platformSourceFiles(cwd, 'index'),
    ...platformSourceFiles(cwd, 'App'),
  ]);
}

function preflightNativeSetup(
  cwd: string,
  pkg: PackageJson,
  isExpo: boolean,
): NativeSetupPlan | string {
  const existingConfigs = findMetroConfigPaths(cwd);

  if (pkg.metro !== undefined) {
    return 'a package.json Metro configuration was found';
  }
  if (existingConfigs.length > 1) {
    return `multiple Metro config files were found (${existingConfigs.map((path) => path.split(sep).pop()).join(', ')})`;
  }

  const entries = findNativeEntryFiles(cwd, pkg, isExpo);
  if (entries.length === 0) {
    return 'no supported reachable app entry was found';
  }

  if (existingConfigs.length === 0) {
    const path = join(cwd, pkg.type === 'module' ? 'metro.config.cjs' : 'metro.config.js');
    return {
      config: { path, content: generatedMetroConfig(isExpo) },
      entries,
    };
  }

  const path = existingConfigs[0];
  if (!path.endsWith('.js') && !path.endsWith('.cjs')) {
    return `${path.split(sep).pop()} is not a CommonJS .js or .cjs Metro config`;
  }
  if (path.endsWith('.js') && pkg.type === 'module') {
    return 'metro.config.js is interpreted as ESM because package.json declares type: module';
  }

  const content = readFileSync(path, 'utf-8');
  return {
    config: {
      path,
      content: content.includes('agent-react-devtools/metro')
        ? null
        : `${content.replace(/\n?$/, '\n')}${nativeMetroWrapperBlock()}`,
    },
    entries,
  };
}

function patchNativeEntry(path: string, dryRun: boolean): string | null {
  const content = readFileSync(path, 'utf-8');
  if (content.includes('agent-react-devtools/react-native')) return null;
  const patched = `${NATIVE_IMPORT_MARKER}\n${NATIVE_IMPORT}\n${content}`;
  if (!dryRun) writeFileSync(path, patched, 'utf-8');
  return path;
}

function removeNativeEntryImport(path: string, dryRun: boolean): string | null {
  const content = readFileSync(path, 'utf-8');
  const patched = content.replace(
    /\/\/ @agent-react-devtools:react-native-bootstrap\nimport 'agent-react-devtools\/react-native';\n?/g,
    '',
  );
  if (patched === content) return null;
  if (!dryRun) writeFileSync(path, patched, 'utf-8');
  return path;
}

function patchReactNative(cwd: string, dryRun: boolean, isExpo: boolean): string[] {
  const pkg = readPackageJson(cwd);
  if (!pkg) return [];
  const plan = preflightNativeSetup(cwd, pkg, isExpo);
  if (typeof plan === 'string') {
    console.log(`\nReact Native/Expo automatic setup could not safely continue: ${plan}.`);
    console.log('Manual setup required: wrap your final CommonJS Metro config with withAgentReactDevTools and import agent-react-devtools/react-native from a reachable app module.');
    return [];
  }

  const modified: string[] = [];
  if (plan.config.content !== null) {
    if (!dryRun) writeFileSync(plan.config.path, plan.config.content, 'utf-8');
    modified.push(plan.config.path);
  }
  for (const entry of plan.entries) {
    const patched = patchNativeEntry(entry, dryRun);
    if (patched) modified.push(patched);
  }
  return modified;
}

function unpatchReactNative(cwd: string, dryRun: boolean, isExpo: boolean): string[] {
  const pkg = readPackageJson(cwd);
  if (!pkg) return [];
  const modified: string[] = [];

  for (const entry of findAllNativeEntryFiles(cwd, pkg)) {
    const patched = removeNativeEntryImport(entry, dryRun);
    if (patched) modified.push(entry);
  }

  for (const path of findMetroConfigPaths(cwd)) {
    const content = readFileSync(path, 'utf-8');
    const generated = generatedMetroConfig(isExpo);
    if (content === generated) {
      if (!dryRun) unlinkSync(path);
      modified.push(path);
      continue;
    }
    if (content.startsWith(GENERATED_METRO_MARKER)) {
      console.warn(`  ${path} was generated by init but has been modified; leaving it in place.`);
      continue;
    }

    const patched = content.replace(
      /\n?\/\/ @agent-react-devtools:metro-wrapper:start\nconst \{ withAgentReactDevTools \} = require\('agent-react-devtools\/metro'\);\nmodule\.exports = withAgentReactDevTools\(module\.exports\);\n\/\/ @agent-react-devtools:metro-wrapper:end\n?/g,
      '\n',
    );
    if (patched !== content) {
      if (!dryRun) writeFileSync(path, patched, 'utf-8');
      modified.push(path);
    }
  }

  return modified;
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
    case 'react-native':
      modified = unpatchReactNative(cwd, dryRun, false);
      break;
    case 'expo':
      modified = unpatchReactNative(cwd, dryRun, true);
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
    case 'react-native':
      modified = patchReactNative(cwd, dryRun, false);
      break;
    case 'expo':
      modified = patchReactNative(cwd, dryRun, true);
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
  if (framework === 'react-native' || framework === 'expo') {
    console.log('  1. Start daemon: agent-react-devtools start');
    console.log('  2. Restart Metro and your app');
    console.log('  3. Inspect: agent-react-devtools get tree');
  } else {
    console.log('  1. Install: npm install -D agent-react-devtools react-devtools-core');
    console.log('  2. Start daemon: agent-react-devtools start');
    console.log('  3. Start dev server and open your app');
    console.log('  4. Inspect: agent-react-devtools get tree');
  }
}
