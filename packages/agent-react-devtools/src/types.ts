// ── Component Tree ──

export type ComponentType =
  | 'function'
  | 'class'
  | 'host'
  | 'memo'
  | 'forwardRef'
  | 'profiler'
  | 'suspense'
  | 'context'
  | 'other';

export interface ComponentNode {
  id: number;
  displayName: string;
  type: ComponentType;
  key: string | null;
  parentId: number | null;
  children: number[];
  /** Renderer that owns this node */
  rendererId: number;
  /** Number of errors logged by this component (from React DevTools protocol) */
  errors: number;
  /** Number of warnings logged by this component (from React DevTools protocol) */
  warnings: number;
}

export interface InspectedElement {
  id: number;
  displayName: string;
  type: ComponentType;
  key: string | null;
  props: Record<string, unknown>;
  state: Record<string, unknown> | null;
  hooks: HookInfo[] | null;
  renderedAt: number | null;
}

export interface HookInfo {
  name: string;
  value: unknown;
  subHooks?: HookInfo[];
}

// ── Profiling ──

export interface ProfilingSession {
  name: string;
  startedAt: number;
  stoppedAt: number | null;
  commits: ProfilingCommit[];
  /** Raw per-root data from React DevTools, stored for export passthrough. */
  rawRoots: ProfilingRootRawData[];
}

export interface ProfilingCommit {
  timestamp: number;
  duration: number;
  fiberActualDurations: Map<number, number>;
  fiberSelfDurations: Map<number, number>;
  changeDescriptions: Map<number, ChangeDescription>;
  effectDuration: number | null;
  passiveEffectDuration: number | null;
  priorityLevel: string | null;
  updaters: unknown[] | null;
}

/** Raw per-root profiling data from React DevTools, stored for export passthrough. */
export interface ProfilingRootRawData {
  rootID: number;
  commitData: unknown[];
  initialTreeBaseDurations: Array<[number, number]>;
  operations: Array<number[]>;
  snapshots: Array<[number, unknown]>;
  displayName: string;
}

export interface ChangeDescription {
  didHooksChange: boolean;
  isFirstMount: boolean;
  props: string[] | null;
  state: string[] | null;
  hooks: number[] | null;
}

export interface ChangedKeys {
  props: string[];
  state: string[];
  hooks: number[];
}

export interface ComponentRenderReport {
  id: number;
  displayName: string;
  label?: string;
  type?: ComponentType;
  renderCount: number;
  totalDuration: number;
  avgDuration: number;
  maxDuration: number;
  causes: RenderCause[];
  changedKeys?: ChangedKeys;
}

export type RenderCause =
  | 'props-changed'
  | 'state-changed'
  | 'hooks-changed'
  | 'parent-rendered'
  | 'force-update'
  | 'first-mount';

// ── React DevTools Profiler Export (version 5) ──

export interface ProfilingDataExport {
  version: 5;
  dataForRoots: ProfilingDataForRootExport[];
  timelineData?: unknown[];
}

export interface ProfilingDataForRootExport {
  commitData: CommitDataExport[];
  displayName: string;
  initialTreeBaseDurations: Array<[number, number]>;
  operations: Array<Array<number>>;
  rootID: number;
  snapshots: Array<[number, SnapshotNodeExport]>;
}

export interface CommitDataExport {
  changeDescriptions: Array<[number, ChangeDescriptionExport]> | null;
  duration: number;
  effectDuration: number | null;
  fiberActualDurations: Array<[number, number]>;
  fiberSelfDurations: Array<[number, number]>;
  passiveEffectDuration: number | null;
  priorityLevel: string | null;
  timestamp: number;
  updaters: Array<{ id: number; displayName: string; type: number }> | null;
}

export interface ChangeDescriptionExport {
  context: null;
  didHooksChange: boolean;
  isFirstMount: boolean;
  props: string[] | null;
  state: string[] | null;
  hooks: number[] | null;
}

export interface SnapshotNodeExport {
  id: number;
  children: number[];
  displayName: string | null;
  hocDisplayNames: string[] | null;
  key: string | null;
  type: number;
  compiledWithForget: boolean;
}

// ── Connection Health ──

export type ConnectionEventType = 'connected' | 'disconnected' | 'reconnected';

export interface ConnectionEvent {
  type: ConnectionEventType;
  timestamp: number;
}

/** No app is attached, so a component read has nothing to observe. */
export type IpcErrorCode = 'NO_APP_CONNECTED';

export interface ConnectionHealth {
  connectedApps: number;
  hasEverConnected: boolean;
  lastDisconnectAt: number | null;
  recentEvents: ConnectionEvent[];
}

// ── IPC Commands ──

export type IpcCommand =
  | { type: 'ping' }
  | { type: 'status' }
  | { type: 'get-tree'; depth?: number; noHost?: boolean; maxLines?: number; root?: number | string }
  | { type: 'get-component'; id: number | string }
  | { type: 'find'; name: string; exact?: boolean }
  | { type: 'count' }
  | { type: 'profile-start'; name?: string }
  | { type: 'profile-stop' }
  | { type: 'profile-report'; componentId: number | string }
  | { type: 'profile-slow'; limit?: number }
  | { type: 'profile-rerenders'; limit?: number }
  | { type: 'profile-timeline'; limit?: number; offset?: number; sort?: 'duration' | 'timeline' }
  | { type: 'profile-commit'; index: number; limit?: number }
  | { type: 'profile-export' }
  | { type: 'errors' }
  | { type: 'wait'; condition: 'connected'; timeout?: number }
  | { type: 'wait'; condition: 'component'; name: string; timeout?: number };

export interface IpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Machine-readable reason for a refusal, so callers need not match on `error`. */
  code?: IpcErrorCode;
  /** The @cN label, passed through when commands use label-based IDs */
  label?: string;
  /** Contextual hint for empty or stale results */
  hint?: string;
}

// ── Daemon State ──

export interface DaemonInfo {
  pid: number;
  port: number;
  socketPath: string;
  startedAt: number;
  /** mtime of daemon.js when the daemon was spawned */
  buildMtime?: number;
}

export interface StatusInfo {
  daemonRunning: boolean;
  port: number;
  connectedApps: number;
  componentCount: number;
  profilingActive: boolean;
  uptime: number;
  connection: ConnectionHealth;
}
