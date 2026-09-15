import type {
  ProfilingSession,
  ProfilingCommit,
  ChangeDescription,
  ComponentRenderReport,
  RenderCause,
  ChangedKeys,
  ProfilingDataExport,
  ProfileComponentMetadata,
} from './types.js';
import type { ComponentTree } from './component-tree.js';
import { buildExportData } from './profile-export.js';

export interface ProfileSummary {
  name: string;
  duration: number;
  commitCount: number;
  componentRenderCounts: { id: number; displayName: string; label?: string; type?: string; count: number }[];
}

export interface TimelineEntry {
  index: number;
  timestamp: number;
  duration: number;
  componentCount: number;
}

export interface TimelineResult {
  entries: TimelineEntry[];
  total: number;
  offset: number;
}

export interface CommitDetail {
  index: number;
  timestamp: number;
  duration: number;
  components: Array<{
    id: number;
    displayName: string;
    label?: string;
    type?: string;
    actualDuration: number;
    selfDuration: number;
    causes: RenderCause[];
    changedKeys?: ChangedKeys;
  }>;
  totalComponents: number;
}

export class Profiler {
  private session: ProfilingSession | null = null;
  /** Display names captured during profiling (survives unmounts) */
  private displayNames = new Map<number, string>();

  isActive(): boolean {
    return this.session !== null && this.session.stoppedAt === null;
  }

  start(name?: string): void {
    this.displayNames.clear();
    this.session = {
      name: name || `session-${Date.now()}`,
      startedAt: Date.now(),
      stoppedAt: null,
      commits: [],
      rawRoots: [],
      componentMetadata: new Map(),
    };
  }

  /** Cache a component's display name (call during profiling to survive unmounts) */
  trackComponent(id: number, displayName: string): void {
    this.displayNames.set(id, displayName);
  }

  getProfiledComponentIds(): number[] {
    if (!this.session) return [];

    const componentIds = new Set<number>();
    for (const commit of this.session.commits) {
      for (const id of commit.fiberActualDurations.keys()) {
        componentIds.add(id);
      }
    }
    return Array.from(componentIds);
  }

  setComponentMetadata(id: number, metadata: ProfileComponentMetadata): void {
    if (!this.session) return;

    const current = this.session.componentMetadata.get(id) || {};
    this.session.componentMetadata.set(id, { ...current, ...metadata });
  }

  resolveProfiledComponentId(id: number | string): number | undefined {
    if (!this.session) return undefined;

    if (typeof id === 'number') {
      return this.session.componentMetadata.has(id) ? id : undefined;
    }

    const match = id.match(/^@c\?\(id:(\d+)\)$/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      return this.session.componentMetadata.has(parsed) ? parsed : undefined;
    }

    if (id.startsWith('@c')) {
      for (const [componentId, metadata] of this.session.componentMetadata) {
        if (metadata.label === id) return componentId;
      }
      return undefined;
    }

    const parsed = parseInt(id, 10);
    if (isNaN(parsed)) return undefined;
    return this.session.componentMetadata.has(parsed) ? parsed : undefined;
  }

  stop(tree?: ComponentTree): ProfileSummary | null {
    if (!this.session) return null;
    this.session.stoppedAt = Date.now();

    const duration = this.session.stoppedAt - this.session.startedAt;

    // Count renders per component
    const renderCounts = new Map<number, number>();
    for (const commit of this.session.commits) {
      for (const [id] of commit.fiberActualDurations) {
        renderCounts.set(id, (renderCounts.get(id) || 0) + 1);
      }
    }

    const componentRenderCounts = Array.from(renderCounts.entries())
      .map(([id, count]) => ({
        id,
        displayName: tree?.getNode(id)?.displayName || this.displayNames.get(id) || '',
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      name: this.session.name,
      duration,
      commitCount: this.session.commits.length,
      componentRenderCounts,
    };
  }

  /**
   * Process profiling data sent from React DevTools.
   *
   * The data format varies between React versions. We handle the common
   * format where each commit contains:
   * - commitTime
   * - duration
   * - fiberActualDurations: [id, duration, ...]
   * - fiberSelfDurations: [id, duration, ...]
   * - changeDescriptions: Map<id, description>
   */
  processProfilingData(payload: unknown): void {
    if (!this.session) return;

    const data = payload as {
      dataForRoots?: Array<{
        rootID?: number;
        commitData?: unknown[];
        operations?: Array<number[]>;
        initialTreeBaseDurations?: Array<[number, number]>;
        snapshots?: Array<[number, unknown]>;
        displayName?: string;
      }>;
      // Alternative flat format
      commitData?: unknown[];
    };

    // Handle nested format (dataForRoots)
    const roots = data?.dataForRoots;
    if (roots) {
      for (const root of roots) {
        // Store raw root data for export passthrough
        this.session.rawRoots.push({
          rootID: root.rootID ?? 1,
          commitData: root.commitData ?? [],
          initialTreeBaseDurations: root.initialTreeBaseDurations ?? [],
          operations: root.operations ?? [],
          snapshots: root.snapshots ?? [],
          displayName: root.displayName ?? 'Root',
        });

        if (root.commitData) {
          for (const commitData of root.commitData) {
            this.processCommitData(commitData as Record<string, unknown>);
          }
        }
      }
      return;
    }

    // Handle flat format
    if (data?.commitData) {
      for (const commitData of data.commitData) {
        this.processCommitData(commitData as Record<string, unknown>);
      }
    }
  }

  private processCommitData(commitData: Record<string, unknown>): void {
    const commit: ProfilingCommit = {
      timestamp: (commitData.timestamp as number) || Date.now(),
      duration: (commitData.duration as number) || 0,
      fiberActualDurations: new Map(),
      fiberSelfDurations: new Map(),
      changeDescriptions: new Map(),
      effectDuration: (commitData.effectDuration as number) ?? null,
      passiveEffectDuration: (commitData.passiveEffectDuration as number) ?? null,
      priorityLevel: (commitData.priorityLevel as string) ?? null,
      updaters: (commitData.updaters as unknown[]) ?? null,
    };

    // Parse fiber durations (can be [id, duration, id, duration, ...] or [[id, duration], ...])
    if (commitData.fiberActualDurations) {
      parseDurations(commitData.fiberActualDurations as Array<[number, number]> | number[], commit.fiberActualDurations);
    }
    if (commitData.fiberSelfDurations) {
      parseDurations(commitData.fiberSelfDurations as Array<[number, number]> | number[], commit.fiberSelfDurations);
    }

    // Parse change descriptions
    const rawDescs = commitData.changeDescriptions as Array<[number, unknown]> | Map<number, unknown> | undefined;
    if (rawDescs) {
      const entries =
        rawDescs instanceof Map
          ? rawDescs.entries()
          : rawDescs[Symbol.iterator]();
      for (const [id, desc] of entries) {
        const d = desc as {
          didHooksChange?: boolean;
          isFirstMount?: boolean;
          props?: string[] | null;
          state?: string[] | null;
          hooks?: number[] | null;
        };
        commit.changeDescriptions.set(id as number, {
          didHooksChange: d.didHooksChange || false,
          isFirstMount: d.isFirstMount || false,
          props: d.props || null,
          state: d.state || null,
          hooks: d.hooks || null,
        });
      }
    }

    this.session!.commits.push(commit);
  }

  getReport(
    componentId: number,
    tree: ComponentTree,
  ): ComponentRenderReport | null {
    if (!this.session) return null;

    const node = tree.getNode(componentId);
    let renderCount = 0;
    let totalDuration = 0;
    let maxDuration = 0;
    const causeSet = new Set<RenderCause>();
    const propsSet = new Set<string>();
    const stateSet = new Set<string>();
    const hooksSet = new Set<number>();

    for (const commit of this.session.commits) {
      const duration = commit.fiberActualDurations.get(componentId);
      if (duration !== undefined) {
        renderCount++;
        totalDuration += duration;
        if (duration > maxDuration) maxDuration = duration;

        const desc = commit.changeDescriptions.get(componentId);
        if (desc) {
          for (const cause of describeCauses(desc)) {
            causeSet.add(cause);
          }
          const keys = extractChangedKeys(desc);
          for (const p of keys.props) propsSet.add(p);
          for (const s of keys.state) stateSet.add(s);
          for (const h of keys.hooks) hooksSet.add(h);
        }
      }
    }

    if (renderCount === 0) return null;

    const metadata = this.session.componentMetadata.get(componentId);

    return {
      id: componentId,
      displayName: node?.displayName || this.displayNames.get(componentId) || `Component#${componentId}`,
      label: metadata?.label,
      type: metadata?.type,
      path: metadata?.path,
      source: metadata?.source,
      sourceKey: metadata?.sourceKey,
      renderCount,
      totalDuration,
      avgDuration: totalDuration / renderCount,
      maxDuration,
      causes: Array.from(causeSet),
      changedKeys: {
        props: Array.from(propsSet),
        state: Array.from(stateSet),
        hooks: Array.from(hooksSet),
      },
    };
  }

  getSlowest(
    tree: ComponentTree,
    limit = 10,
  ): ComponentRenderReport[] {
    return this.getAllReports(tree)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  getMostRerenders(
    tree: ComponentTree,
    limit = 10,
  ): ComponentRenderReport[] {
    return this.getAllReports(tree)
      .sort((a, b) => b.renderCount - a.renderCount)
      .slice(0, limit);
  }

  getCommitDetails(index: number, tree: ComponentTree, limit = 10): CommitDetail | null {
    if (!this.session) return null;
    if (index < 0 || index >= this.session.commits.length) return null;

    const commit = this.session.commits[index];
    const components: CommitDetail['components'] = [];

    for (const [id, actualDuration] of commit.fiberActualDurations) {
      const selfDuration = commit.fiberSelfDurations.get(id) || 0;
      const desc = commit.changeDescriptions.get(id);
      components.push({
        id,
        displayName: tree.getNode(id)?.displayName || this.displayNames.get(id) || `Component#${id}`,
        actualDuration,
        selfDuration,
        causes: desc ? describeCauses(desc) : [],
        changedKeys: desc ? extractChangedKeys(desc) : { props: [], state: [], hooks: [] },
      });
    }

    components.sort((a, b) => b.selfDuration - a.selfDuration);

    const totalCount = components.length;

    return {
      index,
      timestamp: commit.timestamp,
      duration: commit.duration,
      components: limit > 0 ? components.slice(0, limit) : components,
      totalComponents: totalCount,
    };
  }

  getTimeline(limit: number = 20, offset?: number, sort?: 'duration' | 'timeline'): TimelineResult {
    if (!this.session) return { entries: [], total: 0, offset: offset ?? 0 };

    const all = this.session.commits.map((commit, index) => ({
      index,
      timestamp: commit.timestamp,
      duration: commit.duration,
      componentCount: commit.fiberActualDurations.size,
    }));

    if (sort === 'duration') all.sort((a, b) => b.duration - a.duration);
    const start = Math.max(0, offset ?? 0);
    return {
      entries: all.slice(start, start + limit),
      total: all.length,
      offset: start,
    };
  }

  getExportData(tree: ComponentTree): ProfilingDataExport | null {
    if (!this.session) return null;
    return buildExportData(this.session, tree);
  }

  private getAllReports(tree: ComponentTree): ComponentRenderReport[] {
    if (!this.session) return [];

    const reports: ComponentRenderReport[] = [];
    for (const id of this.getProfiledComponentIds()) {
      const report = this.getReport(id, tree);
      if (report) reports.push(report);
    }
    return reports;
  }
}

function parseDurations(
  raw: Array<[number, number]> | number[],
  target: Map<number, number>,
): void {
  if (raw.length === 0) return;

  // Check if it's array of tuples or flat array
  if (Array.isArray(raw[0])) {
    // [[id, duration], ...]
    for (const [id, duration] of raw as Array<[number, number]>) {
      target.set(id, duration);
    }
  } else {
    // [id, duration, id, duration, ...]
    const flat = raw as number[];
    for (let i = 0; i < flat.length; i += 2) {
      target.set(flat[i], flat[i + 1]);
    }
  }
}

function describeCauses(desc: ChangeDescription): RenderCause[] {
  const causes: RenderCause[] = [];
  if (desc.isFirstMount) {
    causes.push('first-mount');
    return causes;
  }
  if (desc.props && desc.props.length > 0) causes.push('props-changed');
  if (desc.state && desc.state.length > 0) causes.push('state-changed');
  if (desc.didHooksChange) causes.push('hooks-changed');
  // If no specific cause found, it was likely parent-triggered
  if (causes.length === 0) causes.push('parent-rendered');
  return causes;
}

function extractChangedKeys(desc: ChangeDescription): ChangedKeys {
  return {
    props: desc.props ?? [],
    state: desc.state ?? [],
    hooks: desc.hooks ?? [],
  };
}
