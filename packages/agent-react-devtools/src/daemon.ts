import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DevToolsBridge } from './devtools-bridge.js';
import { ComponentTree } from './component-tree.js';
import { Profiler } from './profiler.js';
import type { IpcCommand, IpcResponse, DaemonInfo, StatusInfo, ProfileComponentMetadata } from './types.js';
import { getSourceIdentity } from './source-metadata.js';

const DEFAULT_STATE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.agent-react-devtools',
);

let STATE_DIR = DEFAULT_STATE_DIR;
const PROFILE_READ_ENRICH_CONCURRENCY = 5;
const PROFILE_READ_ENRICH_TIMEOUT_MS = 1000;

function getSocketPath(): string {
  return path.join(STATE_DIR, 'daemon.sock');
}

function getDaemonInfoPath(): string {
  return path.join(STATE_DIR, 'daemon.json');
}

function enrichWithLabels(
  items: Array<{ id: number; label?: string; type?: string; path?: string }>,
  tree: ComponentTree,
): void {
  for (const item of items) {
    if (!item.label) item.label = tree.getLabel(item.id);
    if (!item.type) {
      const node = tree.getNode(item.id);
      if (node) item.type = node.type;
    }
    if (!item.path) item.path = tree.getPathString(item.id, false, 3);
  }
}

function collectStaticProfileMetadata(
  componentIds: number[],
  tree: ComponentTree,
): Map<number, ProfileComponentMetadata> {
  const metadata = new Map<number, ProfileComponentMetadata>();

  for (const id of componentIds) {
    metadata.set(id, {
      label: tree.getLabel(id),
      type: tree.getNode(id)?.type,
      path: tree.getPathString(id, false, 3),
    });
  }

  return metadata;
}

async function enrichProfileMetadataOnDemand(
  reports: Array<{ id: number }>,
  tree: ComponentTree,
  bridge: DevToolsBridge,
  profiler: Profiler,
): Promise<void> {
  const queue = [...new Set(reports.map((report) => report.id))];
  if (queue.length === 0) return;

  const concurrency = Math.min(PROFILE_READ_ENRICH_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) return;

      const treeMetadata: ProfileComponentMetadata = {};
      const label = tree.getLabel(id);
      const type = tree.getNode(id)?.type;
      const path = tree.getPathString(id, false, 3);
      if (label !== undefined) treeMetadata.label = label;
      if (type !== undefined) treeMetadata.type = type;
      if (path !== undefined) treeMetadata.path = path;
      if (Object.keys(treeMetadata).length > 0) {
        profiler.setComponentMetadata(id, treeMetadata);
      }

      const inspected = await bridge.inspectElement(id, {
        preferCache: true,
        timeoutMs: PROFILE_READ_ENRICH_TIMEOUT_MS,
      });
      if (!inspected?.source) continue;

      profiler.setComponentMetadata(id, {
        source: inspected.source,
        sourceKey: getSourceIdentity(inspected.source),
      });
    }
  }));
}

class Daemon {
  private ipcServer: net.Server | null = null;
  private bridge: DevToolsBridge;
  private tree: ComponentTree;
  private profiler: Profiler;
  private port: number;
  private startedAt = Date.now();

  constructor(port: number) {
    this.port = port;
    this.tree = new ComponentTree();
    this.profiler = new Profiler();
    this.bridge = new DevToolsBridge(port, this.tree, this.profiler);
  }

  async start(): Promise<void> {
    // Ensure state directory exists
    fs.mkdirSync(STATE_DIR, { recursive: true });

    // Clean up stale socket
    const socketPath = getSocketPath();
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }

    // Start WebSocket bridge
    await this.bridge.start();

    // Start IPC server
    await this.startIpc(socketPath);

    // Write daemon info
    let buildMtime: number | undefined;
    try {
      buildMtime = fs.statSync(new URL(import.meta.url).pathname).mtimeMs;
    } catch {
      // ignore
    }
    const info: DaemonInfo = {
      pid: process.pid,
      port: this.port,
      socketPath,
      startedAt: this.startedAt,
      buildMtime,
    };
    fs.writeFileSync(getDaemonInfoPath(), JSON.stringify(info, null, 2));

    console.log(`Daemon started (pid=${process.pid}, port=${this.port})`);

    // Handle shutdown
    const shutdown = () => {
      this.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  private startIpc(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ipcServer = net.createServer((conn) => {
        let buffer = '';

        conn.on('data', (chunk) => {
          buffer += chunk.toString();

          // Process complete messages (newline-delimited JSON)
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);

            try {
              const cmd: IpcCommand = JSON.parse(line);
              this.handleCommand(cmd, conn).then((response) => {
                if (!conn.destroyed) {
                  conn.write(JSON.stringify(response) + '\n');
                }
              });
            } catch {
              const response: IpcResponse = {
                ok: false,
                error: 'Invalid JSON',
              };
              conn.write(JSON.stringify(response) + '\n');
            }
          }
        });
      });

      this.ipcServer.on('error', reject);

      this.ipcServer.listen(socketPath, () => {
        resolve();
      });
    });
  }

  /**
   * Commands that observe the live component tree must fail when no app is
   * attached. An empty tree is not evidence of anything: reporting it as a
   * result lets "no components with errors" stand in for "nothing was observed".
   */
  private requireAttachedApp(): IpcResponse | null {
    const health = this.bridge.getConnectionHealth();
    if (health.connectedApps > 0) return null;

    const state = health.lastDisconnectAt !== null
      ? `app disconnected ${Math.round((Date.now() - health.lastDisconnectAt) / 1000)}s ago, waiting for reconnect`
      : health.hasEverConnected
        ? 'app disconnected'
        : 'no app has connected since the daemon started';
    return {
      ok: false,
      reason: 'no-app-attached',
      error:
        `No React app is attached to the DevTools daemon on port ${this.port} (${state}). ` +
        'Start the app in development mode, then run `agent-react-devtools wait --connected`. ' +
        'React Native 0.87+ apps also need `agent-react-devtools init`.',
    };
  }

  private async handleCommand(cmd: IpcCommand, conn: net.Socket): Promise<IpcResponse> {
    try {
      switch (cmd.type) {
        case 'ping':
          return { ok: true, data: 'pong' };

        case 'status':
          return {
            ok: true,
            data: {
              daemonRunning: true,
              port: this.port,
              connectedApps: this.bridge.getConnectedAppCount(),
              componentCount: this.tree.getComponentCount(),
              profilingActive: this.profiler.isActive(),
              uptime: Date.now() - this.startedAt,
              connection: this.bridge.getConnectionHealth(),
            } satisfies StatusInfo,
          };

        case 'get-tree': {
          const detached = this.requireAttachedApp();
          if (detached) return detached;
          let resolvedRoot: number | undefined;
          if (cmd.root !== undefined) {
            resolvedRoot = this.tree.resolveId(cmd.root);
            if (resolvedRoot === undefined) {
              return { ok: false, error: `Component ${cmd.root} not found` };
            }
          }
          const totalCount = this.tree.getComponentCount();
          const treeData = this.tree.getTree({
            maxDepth: cmd.depth,
            noHost: cmd.noHost,
            rootId: resolvedRoot,
          });
          // If a specific root was requested but returned empty, the node
          // was removed between resolveId and getTree (stale label)
          if (resolvedRoot !== undefined && treeData.length === 0) {
            return { ok: false, error: `Component ${cmd.root} not found` };
          }
          return { ok: true, data: { nodes: treeData, totalCount } };
        }

        case 'get-component': {
          const detachedForComponent = this.requireAttachedApp();
          if (detachedForComponent) return detachedForComponent;
          const resolvedId = this.tree.resolveId(cmd.id);
          if (resolvedId === undefined) {
            return { ok: false, error: `Component ${cmd.id} not found` };
          }
          const element = await this.bridge.inspectElement(resolvedId);
          if (!element) {
            return { ok: false, error: `Component ${cmd.id} not found` };
          }
          // Include error/warning counts when non-zero
          const treeNode = this.tree.getNode(resolvedId);
          const enriched: Record<string, unknown> = { ...element };
          if (treeNode && treeNode.errors > 0) enriched.errors = treeNode.errors;
          if (treeNode && treeNode.warnings > 0) enriched.warnings = treeNode.warnings;
          // Include the label if the request used one
          const label = typeof cmd.id === 'string' ? cmd.id : undefined;
          return { ok: true, data: enriched, label };
        }

        case 'find':
          return this.requireAttachedApp() ?? {
            ok: true,
            data: this.tree.findByName(cmd.name, cmd.exact),
          };

        case 'count':
          return this.requireAttachedApp() ?? {
            ok: true,
            data: this.tree.getCountByType(),
          };

        case 'errors': {
          const detachedForErrors = this.requireAttachedApp();
          if (detachedForErrors) return detachedForErrors;
          this.tree.getTree();
          return {
            ok: true,
            data: this.tree.getComponentsWithErrorsOrWarnings(),
          };
        }

        case 'profile-start': {
          const detachedForProfile = this.requireAttachedApp();
          if (detachedForProfile) return detachedForProfile;
          this.profiler.start(cmd.name);
          // Snapshot existing component names so they survive unmounts
          for (const id of this.tree.getAllNodeIds()) {
            const node = this.tree.getNode(id);
            if (node) this.profiler.trackComponent(id, node.displayName);
          }
          this.bridge.startProfiling();
          return { ok: true, data: 'Profiling started' };
        }

        case 'profile-stop': {
          await this.bridge.stopProfilingAndCollect();
          // Build stable labels for this snapshot before the app changes again.
          this.tree.getTree();
          const metadata = collectStaticProfileMetadata(
            this.profiler.getProfiledComponentIds(),
            this.tree,
          );
          const session = this.profiler.stop(this.tree);
          if (!session) {
            return { ok: false, error: 'No active profiling session' };
          }
          for (const [id, item] of metadata) {
            this.profiler.setComponentMetadata(id, item);
          }
          enrichWithLabels(session.componentRenderCounts, this.tree);
          return { ok: true, data: session };
        }

        case 'profile-report': {
          const resolvedCompId =
            this.tree.resolveId(cmd.componentId) ??
            this.profiler.resolveProfiledComponentId(cmd.componentId);
          if (resolvedCompId === undefined) {
            return { ok: false, error: `Component ${cmd.componentId} not found` };
          }
          const report = this.profiler.getReport(resolvedCompId, this.tree);
          if (!report) {
            return {
              ok: false,
              error: `No profiling data for component ${cmd.componentId}`,
            };
          }
          await enrichProfileMetadataOnDemand([{ id: resolvedCompId }], this.tree, this.bridge, this.profiler);
          const refreshedReport = this.profiler.getReport(resolvedCompId, this.tree) || report;
          const compLabel = typeof cmd.componentId === 'string' ? cmd.componentId : undefined;
          return { ok: true, data: refreshedReport, label: compLabel };
        }

        case 'profile-slow': {
          const requestedLimit = cmd.limit;
          const candidateLimit = Math.max(requestedLimit ?? 10, cmd.candidateLimit ?? requestedLimit ?? 10);
          const candidates = this.profiler.getSlowest(this.tree, candidateLimit);
          await enrichProfileMetadataOnDemand(candidates, this.tree, this.bridge, this.profiler);
          const slowest = this.profiler.getSlowest(this.tree, requestedLimit ?? candidateLimit);
          return { ok: true, data: slowest };
        }

        case 'profile-rerenders': {
          const requestedLimit = cmd.limit;
          const candidateLimit = Math.max(requestedLimit ?? 10, cmd.candidateLimit ?? requestedLimit ?? 10);
          const candidates = this.profiler.getMostRerenders(this.tree, candidateLimit);
          await enrichProfileMetadataOnDemand(candidates, this.tree, this.bridge, this.profiler);
          const rerenders = this.profiler.getMostRerenders(this.tree, requestedLimit ?? candidateLimit);
          return { ok: true, data: rerenders };
        }

        case 'profile-timeline':
          return {
            ok: true,
            data: this.profiler.getTimeline(cmd.limit, cmd.offset, cmd.sort),
          };

        case 'profile-commit': {
          const detail = this.profiler.getCommitDetails(cmd.index, this.tree, cmd.limit);
          if (!detail) {
            return { ok: false, error: `Commit #${cmd.index} not found` };
          }
          enrichWithLabels(detail.components, this.tree);
          return { ok: true, data: detail };
        }

        case 'profile-export': {
          const exportData = this.profiler.getExportData(this.tree);
          if (!exportData) {
            return { ok: false, error: 'No profiling data to export (run profile start/stop first)' };
          }
          return { ok: true, data: exportData };
        }

        case 'wait':
          return this.handleWait(cmd, conn);

        default:
          return { ok: false, error: `Unknown command: ${(cmd as any).type}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private handleWait(
    cmd: Extract<IpcCommand, { type: 'wait' }>,
    conn: net.Socket,
  ): Promise<IpcResponse> {
    const timeout = cmd.timeout ?? 30_000;

    // Check if condition is already met
    if (this.isWaitConditionMet(cmd)) {
      return Promise.resolve({ ok: true, data: { met: true, condition: cmd.condition } });
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (response: IpcResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        conn.removeListener('close', onClose);
        resolve(response);
      };

      const unsubscribe = this.bridge.onStateChange(() => {
        if (this.isWaitConditionMet(cmd)) {
          settle({ ok: true, data: { met: true, condition: cmd.condition } });
        }
      });

      const timer = setTimeout(() => {
        settle({ ok: true, data: { met: false, condition: cmd.condition, timeout: true } });
      }, timeout);

      const onClose = () => {
        settle({ ok: false, error: 'Client disconnected' });
      };
      conn.on('close', onClose);
    });
  }

  private isWaitConditionMet(cmd: Extract<IpcCommand, { type: 'wait' }>): boolean {
    switch (cmd.condition) {
      case 'connected':
        return this.bridge.getConnectedAppCount() > 0;
      case 'component':
        return this.tree.findByName(cmd.name, true).length > 0;
      default:
        return false;
    }
  }

  stop(): void {
    this.bridge.stop();
    if (this.ipcServer) {
      this.ipcServer.close();
      this.ipcServer = null;
    }
    // Clean up files
    try {
      fs.unlinkSync(getSocketPath());
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(getDaemonInfoPath());
    } catch {
      // ignore
    }
    console.log('Daemon stopped');
  }
}

// ── Main ──

const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : 8097;

const stateDirArg = process.argv.find((a) => a.startsWith('--state-dir='));
if (stateDirArg) {
  STATE_DIR = stateDirArg.split('=')[1];
}

const daemon = new Daemon(port);
daemon.start().catch((err) => {
  console.error('Failed to start daemon:', err);
  process.exit(1);
});
