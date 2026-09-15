import { WebSocketServer, WebSocket } from 'ws';
import type { ComponentTree } from './component-tree.js';
import type { Profiler } from './profiler.js';
import type { InspectedElement, ConnectionHealth, ConnectionEvent } from './types.js';
import { normalizeSourceLocation } from './source-metadata.js';

/**
 * React DevTools protocol bridge.
 *
 * Implements the "Wall" messaging pattern that React DevTools uses:
 * - The backend (inside React app) sends operations, profiling data, etc.
 * - The frontend (us) can request element inspection, start/stop profiling, etc.
 *
 * Message format over WebSocket:
 *   { event: string, payload: any }
 */

interface DevToolsMessage {
  event: string;
  payload: unknown;
}

interface PendingInspection {
  id: number;
  resolve: (value: InspectedElement | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface InspectOptions {
  preferCache?: boolean;
  timeoutMs?: number;
}

interface PendingProfilingCollect {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
  remaining: number;
}

export class DevToolsBridge {
  private wss: WebSocketServer | null = null;
  private connections = new Set<WebSocket>();
  private port: number;
  private tree: ComponentTree;
  private profiler: Profiler;
  private pendingInspections = new Map<number, PendingInspection>();
  private inspectionCache = new Map<number, InspectedElement>();
  private nextInspectionRequestId = 1;
  private pendingProfilingCollect: PendingProfilingCollect | null = null;
  private rendererIds = new Set<number>();
  /** Track which root fiber IDs belong to each WebSocket connection */
  private connectionRoots = new Map<WebSocket, Set<number>>();
  private hasEverConnected = false;
  private lastDisconnectAt: number | null = null;
  private recentEvents: ConnectionEvent[] = [];
  private reconnectWindowMs = 5000;
  private stateChangeListeners = new Set<() => void>();

  constructor(port: number, tree: ComponentTree, profiler: Profiler) {
    this.port = port;
    this.tree = tree;
    this.profiler = profiler;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        resolve();
      });

      this.wss.on('error', (err) => {
        reject(err);
      });

      this.wss.on('connection', (ws) => {
        this.connections.add(ws);

        // Reconnect = going from 0 to 1 connected app shortly after a disconnect
        const wasDisconnected = this.connections.size === 1 &&
          this.lastDisconnectAt !== null &&
          (Date.now() - this.lastDisconnectAt) < this.reconnectWindowMs;
        const eventType = wasDisconnected ? 'reconnected' as const : 'connected' as const;
        this.hasEverConnected = true;
        this.lastDisconnectAt = null;
        this.pushEvent({ type: eventType, timestamp: Date.now() });
        this.notifyStateChange();

        ws.on('message', (data) => {
          try {
            const msg: DevToolsMessage = JSON.parse(data.toString());
            this.handleMessage(ws, msg);
          } catch {
            // ignore parse errors
          }
        });

        ws.on('close', () => {
          this.cleanupConnection(ws);
        });

        ws.on('error', () => {
          this.cleanupConnection(ws);
        });
      });
    });
  }

  stop(): void {
    for (const conn of this.connections) {
      conn.close();
    }
    this.connections.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  getConnectedAppCount(): number {
    return this.connections.size;
  }

  /**
   * Request detailed inspection of a specific element.
   * Sends a request to the React app and waits for the response.
   */
  inspectElement(id: number, options: InspectOptions = {}): Promise<InspectedElement | null> {
    const node = this.tree.getNode(id);
    if (!node) return Promise.resolve(null);
    const cached = this.inspectionCache.get(id);
    if (options.preferCache && cached) return Promise.resolve(cached);
    if (this.connections.size === 0) return Promise.resolve(cached || null);

    return new Promise((resolve) => {
      const requestID = this.nextInspectionRequestId++;
      const timeoutMs = options.timeoutMs ?? 5000;
      const timer = setTimeout(() => {
        this.pendingInspections.delete(requestID);
        resolve(null);
      }, timeoutMs);

      this.pendingInspections.set(requestID, { id, resolve, timer });

      this.sendToAll({
        event: 'inspectElement',
        payload: {
          id,
          rendererID: node.rendererId,
          forceFullData: true,
          requestID,
          path: null,
        },
      });
    });
  }

  startProfiling(): void {
    this.sendToAll({
      event: 'startProfiling',
      payload: { recordChangeDescriptions: true },
    });
  }

  /**
   * Stop profiling and request data from each renderer.
   * Returns a promise that resolves when profilingData arrives (or 5s timeout).
   */
  stopProfilingAndCollect(): Promise<void> {
    this.sendToAll({
      event: 'stopProfiling',
      payload: undefined,
    });

    // If no renderers known, resolve immediately
    if (this.rendererIds.size === 0) {
      return Promise.resolve();
    }

    // Request profiling data from each renderer
    for (const rendererID of this.rendererIds) {
      this.sendToAll({
        event: 'getProfilingData',
        payload: { rendererID },
      });
    }

    const expected = this.rendererIds.size;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingProfilingCollect = null;
        resolve();
      }, 5000);

      this.pendingProfilingCollect = { resolve, timer, remaining: expected };
    });
  }

  private handleMessage(ws: WebSocket, msg: DevToolsMessage): void {
    switch (msg.event) {
      case 'backendInitialized':
        // Send the full frontend handshake sequence
        this.sendTo(ws, { event: 'getBridgeProtocol', payload: undefined });
        this.sendTo(ws, { event: 'getBackendVersion', payload: undefined });
        this.sendTo(ws, { event: 'getIfHasUnsupportedRendererVersion', payload: undefined });
        this.sendTo(ws, { event: 'getHookSettings', payload: undefined });
        this.sendTo(ws, { event: 'getProfilingStatus', payload: undefined });
        break;

      case 'bridgeProtocol':
      case 'backendVersion':
      case 'profilingStatus':
      case 'overrideComponentFilters':
        break;

      case 'operations':
        this.handleOperations(ws, msg.payload as number[]);
        break;

      case 'inspectedElement':
        this.handleInspectedElement(msg.payload);
        break;

      case 'profilingData':
        this.handleProfilingData(msg.payload);
        break;

      case 'renderer': {
        const payload = msg.payload as { id: number };
        this.rendererIds.add(payload.id);
        break;
      }

      case 'rendererAttached': {
        const payload = msg.payload as { id: number };
        this.rendererIds.add(payload.id);
        break;
      }

      case 'shutdown':
        ws.close();
        break;

      // Silently ignore known but unhandled events
      case 'hookSettings':
      case 'isBackendStorageAPISupported':
      case 'isReactNativeEnvironment':
      case 'isReloadAndProfileSupportedByBackend':
      case 'isSynchronousXHRSupported':
      case 'syncSelectionFromNativeElementsPanel':
      case 'unsupportedRendererVersion':
        break;

      default:
        break;
    }
  }

  private handleOperations(ws: WebSocket, operations: number[]): void {
    if (operations.length >= 2) {
      // Track renderer ID (first element of every operations array)
      this.rendererIds.add(operations[0]);

      // Track which root fiber IDs belong to this connection
      const rootFiberId = operations[1];
      let roots = this.connectionRoots.get(ws);
      if (!roots) {
        roots = new Set();
        this.connectionRoots.set(ws, roots);
      }
      roots.add(rootFiberId);
    }
    const added = this.tree.applyOperations(operations);
    if (this.inspectionCache.size > 0) {
      for (const id of this.inspectionCache.keys()) {
        if (!this.tree.getNode(id)) this.inspectionCache.delete(id);
      }
    }

    // A second root on one connection is either a genuine multi-root app or a
    // re-flush from another DevTools backend attaching; the tree decides by structure.
    const roots = operations.length >= 2 ? this.connectionRoots.get(ws) : undefined;
    if (roots && roots.size > 1) {
      const replaced = this.tree.reconcileReflushedRoot(operations[1]);
      if (replaced !== null) roots.delete(replaced);
    }

    // Cache display names during profiling so unmounted components are still identifiable
    if (this.profiler.isActive()) {
      for (const node of added) {
        this.profiler.trackComponent(node.id, node.displayName);
      }
    }

    this.notifyStateChange();
  }

  private cleanupConnection(ws: WebSocket): void {
    this.connections.delete(ws);
    // Remove all root trees that belonged to this connection
    const roots = this.connectionRoots.get(ws);
    if (roots) {
      for (const rootId of roots) {
        this.tree.removeRoot(rootId);
      }
      this.connectionRoots.delete(ws);
    }
    if (this.connections.size === 0) {
      this.inspectionCache.clear();
      for (const [requestID, pending] of this.pendingInspections) {
        clearTimeout(pending.timer);
        pending.resolve(null);
        this.pendingInspections.delete(requestID);
      }
    }
    this.lastDisconnectAt = Date.now();
    this.pushEvent({ type: 'disconnected', timestamp: Date.now() });
    this.notifyStateChange();
  }

  private handleInspectedElement(payload: unknown): void {
    const data = payload as {
      type: string;
      id: number;
      responseID?: number;
      value?: {
        id: number;
        displayName: string;
        type: number;
        key: string | null;
        props: Record<string, unknown>;
        state: Record<string, unknown> | null;
        hooks: unknown[] | { data: unknown[]; cleaned: unknown[]; unserializable: unknown[] } | null;
        source?: unknown;
      };
    };

    if (data.type !== 'full-data' && data.type !== 'hydrated-path') {
      // No data available
      const pending = data.responseID !== undefined
        ? this.pendingInspections.get(data.responseID)
        : undefined;
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingInspections.delete(data.responseID!);
        pending.resolve(null);
      }
      return;
    }

    const pending = data.responseID !== undefined
      ? this.pendingInspections.get(data.responseID)
      : undefined;
    if (!pending || !data.value) return;

    clearTimeout(pending.timer);
    this.pendingInspections.delete(data.responseID!);

    const node = this.tree.getNode(data.id);
    const inspected: InspectedElement = {
      id: data.id,
      displayName: data.value.displayName || node?.displayName || 'Unknown',
      type: node?.type || 'other',
      key: data.value.key,
      props: cleanDehydrated(data.value.props) as Record<string, unknown>,
      state: data.value.state
        ? (cleanDehydrated(data.value.state) as Record<string, unknown>)
        : null,
      hooks: data.value.hooks
        ? parseHooks(extractHooksArray(data.value.hooks))
        : null,
      renderedAt: null,
      source: normalizeSourceLocation(data.value.source),
    };

    this.inspectionCache.set(data.id, inspected);
    pending.resolve(inspected);
  }

  private handleProfilingData(payload: unknown): void {
    // React DevTools sends profiling data as a complex nested structure.
    // We forward it to the profiler for processing.
    this.profiler.processProfilingData(payload);

    // Resolve once all expected renderer responses have arrived
    if (this.pendingProfilingCollect) {
      this.pendingProfilingCollect.remaining--;
      if (this.pendingProfilingCollect.remaining <= 0) {
        clearTimeout(this.pendingProfilingCollect.timer);
        const pending = this.pendingProfilingCollect;
        this.pendingProfilingCollect = null;
        pending.resolve();
      }
    }
  }

  getConnectionHealth(): ConnectionHealth {
    return {
      connectedApps: this.connections.size,
      hasEverConnected: this.hasEverConnected,
      lastDisconnectAt: this.lastDisconnectAt,
      recentEvents: [...this.recentEvents],
    };
  }

  onStateChange(listener: () => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => { this.stateChangeListeners.delete(listener); };
  }

  private pushEvent(event: ConnectionEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > 20) {
      this.recentEvents = this.recentEvents.slice(-20);
    }
  }

  private notifyStateChange(): void {
    for (const listener of this.stateChangeListeners) {
      listener();
    }
  }

  private sendTo(ws: WebSocket, msg: DevToolsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendToAll(msg: DevToolsMessage): void {
    const raw = JSON.stringify(msg);
    for (const conn of this.connections) {
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(raw);
      }
    }
  }
}

/**
 * React DevTools uses "dehydrated" values for complex objects.
 * These appear as objects with `type: 'string'` and other metadata.
 * We simplify them for display.
 */
function cleanDehydrated(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanDehydrated);

  const record = obj as Record<string, unknown>;

  // Dehydrated value markers from React DevTools
  if ('type' in record && 'preview_short' in record) {
    return record['preview_short'];
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    cleaned[key] = cleanDehydrated(value);
  }
  return cleaned;
}

/**
 * React DevTools may send hooks as a plain array or as a dehydrated object
 * with { data: unknown[], cleaned: unknown[], unserializable: unknown[] }.
 * Extract the array in either case.
 */
function extractHooksArray(hooks: unknown): unknown[] {
  if (Array.isArray(hooks)) return hooks;
  if (hooks && typeof hooks === 'object' && 'data' in hooks && Array.isArray((hooks as Record<string, unknown>).data)) {
    return (hooks as Record<string, unknown>).data as unknown[];
  }
  return [];
}

function parseHooks(hooks: unknown[]): { name: string; value: unknown; subHooks?: { name: string; value: unknown }[] }[] {
  return hooks.map((hook) => {
    const h = hook as {
      id: number | null;
      isStateEditable: boolean;
      name: string;
      value: unknown;
      subHooks?: unknown[];
    };
    const result: { name: string; value: unknown; subHooks?: { name: string; value: unknown }[] } = {
      name: h.name,
      value: cleanDehydrated(h.value),
    };
    if (h.subHooks && h.subHooks.length > 0) {
      result.subHooks = parseHooks(h.subHooks) as { name: string; value: unknown }[];
    }
    return result;
  });
}
