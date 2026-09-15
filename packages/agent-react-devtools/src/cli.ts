import {
  ensureDaemon,
  sendCommand,
  stopDaemon,
  readDaemonInfo,
  setStateDir,
} from './daemon-client.js';
import {
  formatTree,
  formatComponent,
  formatSearchResults,
  formatCount,
  formatErrors,
  formatStatus,
  formatProfileSummary,
  formatProfileReport,
  formatSlowest,
  formatRerenders,
  formatTimeline,
  formatCommitDetail,
  formatProfileDiff,
} from './formatters.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IpcCommand } from './types.js';

function getCandidateLimit(limit: number): number {
  return Math.max(limit, Math.min(60, Math.max(20, limit * 3)));
}

function usage(): string {
  return `Usage: devtools <command> [options]

Setup:
  init [--dry-run]              Auto-configure your React app
  uninit [--dry-run]            Remove configuration added by init

Daemon:
  start [--port 8097]           Start daemon
  stop                          Stop daemon
  status                        Show daemon status

Components:
  get tree [@c1 | id] [--depth N] [--all] [--max-lines N]  Component hierarchy
  get component <@c1 | id>     Props, state, hooks
  find <name> [--exact]         Search by display name
  count                         Component count by type
  errors                        Components with errors/warnings

Wait:
  wait --connected [--timeout S]       Block until an app connects
  wait --component <name> [--timeout S]  Block until a component appears

Profiling:
  profile start [name]          Start profiling session
  profile stop                  Stop profiling, collect data
  profile report <@c1 | id>    Render report for component
  profile slow [--limit N]      Slowest components (by avg)
  profile rerenders [--limit N] Most re-rendered components
  profile timeline [--limit N]  Commit timeline
  profile commit <N | #N> [--limit N]  Detail for specific commit
  profile export <file>               Export as React DevTools JSON
  profile diff <before.json> <after.json> [--limit N] [--threshold N]  Compare two exports`;
}

function parseArgs(argv: string[]): {
  command: string[];
  flags: Record<string, string | boolean>;
} {
  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else {
        // Check if next arg is a value
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      command.push(arg);
    }
  }
  return { command, flags };
}

function parseNumericFlag(
  flags: Record<string, string | boolean>,
  name: string,
  defaultValue?: number,
): number | undefined {
  const raw = flags[name];
  if (raw === undefined || raw === true) return defaultValue;
  const n = parseInt(raw as string, 10);
  if (isNaN(n)) {
    console.error(`Invalid value for --${name}: expected a number`);
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command.length === 0 || flags['help']) {
    console.log(usage());
    process.exit(0);
  }

  // Configure custom state directory (for test isolation)
  if (typeof flags['state-dir'] === 'string') {
    setStateDir(flags['state-dir']);
  }

  const cmd0 = command[0];
  const cmd1 = command[1];

  try {
    // ── Init / Uninit ──
    if (cmd0 === 'init') {
      const { runInit } = await import('./init.js');
      await runInit(process.cwd(), flags['dry-run'] === true);
      return;
    }

    if (cmd0 === 'uninit') {
      const { runUninit } = await import('./init.js');
      await runUninit(process.cwd(), flags['dry-run'] === true);
      return;
    }

    // ── Profile diff (no daemon needed) ──
    if (cmd0 === 'profile' && cmd1 === 'diff') {
      const fileA = command[2];
      const fileB = command[3];
      if (!fileA || !fileB) {
        console.error('Usage: devtools profile diff <before.json> <after.json> [--limit N] [--threshold N]');
        process.exit(1);
      }
      const { loadExportFile, diffProfiles } = await import('./profile-diff.js');
      let before: ReturnType<typeof loadExportFile>;
      let after: ReturnType<typeof loadExportFile>;
      try {
        before = loadExportFile(resolve(fileA));
      } catch (e) {
        console.error(`Error reading ${fileA}: ${(e as Error).message}`);
        process.exit(1);
      }
      try {
        after = loadExportFile(resolve(fileB));
      } catch (e) {
        console.error(`Error reading ${fileB}: ${(e as Error).message}`);
        process.exit(1);
      }
      const limit = parseNumericFlag(flags, 'limit');
      const threshold = parseNumericFlag(flags, 'threshold');
      const diff = diffProfiles(before, after, threshold);
      console.log(formatProfileDiff(diff, limit));
      return;
    }

    // ── Daemon management ──
    if (cmd0 === 'start') {
      const port = parseNumericFlag(flags, 'port');
      await ensureDaemon(port);
      const resp = await sendCommand({ type: 'status' });
      if (resp.ok) {
        console.log(formatStatus(resp.data as any));
      }
      return;
    }

    if (cmd0 === 'stop') {
      const stopped = stopDaemon();
      console.log(stopped ? 'Daemon stopped' : 'Daemon is not running');
      return;
    }

    if (cmd0 === 'status') {
      const info = readDaemonInfo();
      if (!info) {
        console.log('Daemon is not running');
        process.exit(1);
      }
      try {
        const resp = await sendCommand({ type: 'status' });
        if (resp.ok) {
          console.log(formatStatus(resp.data as any));
        } else {
          console.error(resp.error);
          process.exit(1);
        }
      } catch {
        console.log('Daemon is not running (stale info)');
        process.exit(1);
      }
      return;
    }

    // ── All other commands require the daemon ──
    await ensureDaemon();

    // ── Component inspection ──
    if (cmd0 === 'get' && cmd1 === 'tree') {
      const depth = parseNumericFlag(flags, 'depth');
      const maxLines = parseNumericFlag(flags, 'max-lines');
      // Host components are filtered by default; --all includes them
      const noHost = flags['all'] !== true;
      // Parse optional root: `get tree @c5` or `get tree 5`
      const rawRoot = command[2];
      let root: number | string | undefined;
      if (rawRoot) {
        root = rawRoot.startsWith('@') ? rawRoot : parseInt(rawRoot, 10);
        if (typeof root === 'number' && isNaN(root)) {
          console.error('Usage: devtools get tree [@c1 | id] [--depth N] [--all] [--max-lines N]');
          process.exit(1);
        }
      }
      const ipcCmd: IpcCommand = { type: 'get-tree', depth, noHost, maxLines, root };
      const resp = await sendCommand(ipcCmd);
      if (resp.ok) {
        const { nodes, totalCount } = resp.data as any;
        console.log(formatTree(nodes, { hint: resp.hint, totalCount, maxLines }));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'get' && cmd1 === 'component') {
      const raw = command[2];
      if (!raw) {
        console.error('Usage: devtools get component <@c1 | id>');
        process.exit(1);
      }
      const id: number | string = raw.startsWith('@') ? raw : parseInt(raw, 10);
      if (typeof id === 'number' && isNaN(id)) {
        console.error('Usage: devtools get component <@c1 | id>');
        process.exit(1);
      }
      const resp = await sendCommand({ type: 'get-component', id });
      if (resp.ok) {
        console.log(formatComponent(resp.data as any, resp.label));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'find') {
      const name = command[1];
      if (!name) {
        console.error('Usage: devtools find <name> [--exact]');
        process.exit(1);
      }
      const exact = flags['exact'] === true;
      const resp = await sendCommand({ type: 'find', name, exact });
      if (resp.ok) {
        console.log(formatSearchResults(resp.data as any));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'count') {
      const resp = await sendCommand({ type: 'count' });
      if (resp.ok) {
        console.log(formatCount(resp.data as any));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'errors') {
      const resp = await sendCommand({ type: 'errors' });
      if (resp.ok) {
        console.log(formatErrors(resp.data as any));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    // ── Wait ──
    if (cmd0 === 'wait') {
      const timeoutSec = parseNumericFlag(flags, 'timeout', 30)!;
      const timeoutMs = timeoutSec * 1000;
      const socketTimeout = timeoutMs + 5000;

      let ipcCmd: IpcCommand;
      if (flags['connected'] !== undefined) {
        ipcCmd = { type: 'wait', condition: 'connected', timeout: timeoutMs };
      } else if (flags['component'] !== undefined) {
        if (typeof flags['component'] !== 'string') {
          console.error('Usage: devtools wait --component <name> [--timeout S]');
          process.exit(1);
        }
        ipcCmd = { type: 'wait', condition: 'component', name: flags['component'], timeout: timeoutMs };
      } else {
        console.error('Usage: devtools wait --connected|--component <name> [--timeout S]');
        process.exit(1);
      }

      const resp = await sendCommand(ipcCmd, socketTimeout);
      if (resp.ok) {
        const result = resp.data as { met: boolean; condition: string; timeout?: boolean };
        if (result.met) {
          console.log(`Condition met: ${result.condition}`);
        } else {
          console.error(`Timed out waiting for: ${result.condition}`);
          process.exit(1);
        }
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    // ── Profiling ──
    if (cmd0 === 'profile' && cmd1 === 'start') {
      const name = command[2];
      const resp = await sendCommand({ type: 'profile-start', name });
      if (resp.ok) {
        console.log(resp.data);
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'stop') {
      const resp = await sendCommand({ type: 'profile-stop' });
      if (resp.ok) {
        console.log(formatProfileSummary(resp.data as any));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'report') {
      const raw = command[2];
      if (!raw) {
        console.error('Usage: devtools profile report <@c1 | id>');
        process.exit(1);
      }
      const componentId: number | string = raw.startsWith('@') ? raw : parseInt(raw, 10);
      if (typeof componentId === 'number' && isNaN(componentId)) {
        console.error('Usage: devtools profile report <@c1 | id>');
        process.exit(1);
      }
      const resp = await sendCommand({ type: 'profile-report', componentId });
      if (resp.ok) {
        console.log(formatProfileReport(resp.data as any, resp.label));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'slow') {
      const limit = parseNumericFlag(flags, 'limit');
      const visibleLimit = limit ?? 10;
      const resp = await sendCommand({
        type: 'profile-slow',
        limit,
        candidateLimit: getCandidateLimit(visibleLimit),
      });
      if (resp.ok) {
        console.log(formatSlowest(resp.data as any, limit));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'rerenders') {
      const limit = parseNumericFlag(flags, 'limit');
      const visibleLimit = limit ?? 10;
      const resp = await sendCommand({
        type: 'profile-rerenders',
        limit,
        candidateLimit: getCandidateLimit(visibleLimit),
      });
      if (resp.ok) {
        console.log(formatRerenders(resp.data as any, limit));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'commit') {
      const raw = command[2];
      if (!raw) {
        console.error('Usage: devtools profile commit <N | #N>');
        process.exit(1);
      }
      const index = parseInt(raw.replace(/^#/, ''), 10);
      if (isNaN(index)) {
        console.error('Usage: devtools profile commit <N | #N>');
        process.exit(1);
      }
      const limit = parseNumericFlag(flags, 'limit');
      const resp = await sendCommand({ type: 'profile-commit', index, limit });
      if (resp.ok) {
        console.log(formatCommitDetail(resp.data as any));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'timeline') {
      const limit = parseNumericFlag(flags, 'limit');
      const offset = parseNumericFlag(flags, 'offset');
      const sortFlag = flags['sort'];
      const sort = sortFlag === 'duration' ? 'duration' as const
        : sortFlag === 'timeline' ? 'timeline' as const
        : undefined;
      const resp = await sendCommand({ type: 'profile-timeline', limit, offset, sort });
      if (resp.ok) {
        console.log(formatTimeline(resp.data as any));
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    if (cmd0 === 'profile' && cmd1 === 'export') {
      const file = command[2];
      if (!file) {
        console.error('Usage: devtools profile export <file>');
        process.exit(1);
      }
      const resp = await sendCommand({ type: 'profile-export' });
      if (resp.ok) {
        const outPath = resolve(file);
        writeFileSync(outPath, JSON.stringify(resp.data), 'utf-8');
        console.log(`Exported to ${outPath}`);
      } else {
        console.error(resp.error);
        process.exit(1);
      }
      return;
    }

    console.error(`Unknown command: ${command.join(' ')}`);
    console.log(usage());
    process.exit(1);
  } catch (err) {
    console.error(
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
