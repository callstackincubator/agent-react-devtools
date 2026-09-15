import { describe, it, expect, beforeEach } from 'vitest';
import { Profiler } from '../profiler.js';
import { ComponentTree } from '../component-tree.js';

/**
 * Operations encoding reference (protocol v2):
 * [rendererID, rootFiberID, stringTableSize, ...stringTable, ...ops]
 *
 * String table: for each string, [length, ...charCodes]. String ID 0 = null.
 *
 * TREE_OPERATION_ADD (1):
 *   1, id, elementType, parentId, ownerID, displayNameStringID, keyStringID
 */

/** Build a string table and return [tableData, stringIdMap] */
function buildStringTable(strings: string[]): [number[], Map<string, number>] {
  const idMap = new Map<string, number>();
  const data: number[] = [];
  for (const s of strings) {
    const id = idMap.size + 1; // 0 is reserved for null
    if (!idMap.has(s)) {
      idMap.set(s, id);
      data.push(s.length, ...Array.from(s).map((c) => c.charCodeAt(0)));
    }
  }
  return [data, idMap];
}

/** Build a complete operations array with string table */
function buildOps(
  rendererID: number,
  rootID: number,
  strings: string[],
  opsFn: (strId: (s: string) => number) => number[],
): number[] {
  const [tableData, idMap] = buildStringTable(strings);
  const strId = (s: string) => idMap.get(s) || 0;
  const ops = opsFn(strId);
  return [rendererID, rootID, tableData.length, ...tableData, ...ops];
}

function addOp(
  id: number,
  elementType: number,
  parentId: number,
  displayNameStrId: number,
  keyStrId: number = 0,
): number[] {
  return [1, id, elementType, parentId, 0, displayNameStrId, keyStrId];
}

describe('Profiler', () => {
  let profiler: Profiler;
  let tree: ComponentTree;

  beforeEach(() => {
    profiler = new Profiler();
    tree = new ComponentTree();

    // Set up a basic tree (FUNCTION=5 in protocol v2)
    const ops = buildOps(1, 100, ['App', 'Header', 'Content'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('Header')),
      ...addOp(3, 5, 1, s('Content')),
    ]);
    tree.applyOperations(ops);
  });

  it('should track active state', () => {
    expect(profiler.isActive()).toBe(false);
    profiler.start('test');
    expect(profiler.isActive()).toBe(true);
    profiler.stop();
    expect(profiler.isActive()).toBe(false);
  });

  it('should return null when stopping without starting', () => {
    expect(profiler.stop()).toBeNull();
  });

  it('should process flat profiling data', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 15,
          fiberActualDurations: [1, 10, 2, 3, 3, 2],
          fiberSelfDurations: [1, 5, 2, 3, 3, 2],
        },
        {
          timestamp: 2000,
          duration: 8,
          fiberActualDurations: [1, 5, 3, 3],
          fiberSelfDurations: [1, 2, 3, 3],
        },
      ],
    });

    const summary = profiler.stop();
    expect(summary).not.toBeNull();
    expect(summary!.commitCount).toBe(2);
    expect(summary!.componentRenderCounts.length).toBeGreaterThan(0);
  });

  it('should generate render reports', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 15,
          fiberActualDurations: [1, 10, 2, 3],
          fiberSelfDurations: [1, 5, 2, 3],
          changeDescriptions: [
            [1, { props: ['theme'], isFirstMount: false }],
            [2, { isFirstMount: true }],
          ],
        },
        {
          timestamp: 2000,
          duration: 8,
          fiberActualDurations: [1, 20],
          fiberSelfDurations: [1, 15],
          changeDescriptions: [
            [1, { didHooksChange: true, isFirstMount: false }],
          ],
        },
      ],
    });

    const report = profiler.getReport(1, tree);
    expect(report).not.toBeNull();
    expect(report!.displayName).toBe('App');
    expect(report!.renderCount).toBe(2);
    expect(report!.totalDuration).toBe(30);
    expect(report!.avgDuration).toBe(15);
    expect(report!.maxDuration).toBe(20);
    expect(report!.causes).toContain('props-changed');
    expect(report!.causes).toContain('hooks-changed');
    expect(report!.changedKeys!.props).toEqual(['theme']);
    expect(report!.changedKeys!.state).toEqual([]);
    expect(report!.changedKeys!.hooks).toEqual([]);
  });

  it('should deduplicate changed keys across commits', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 5,
          fiberActualDurations: [1, 5],
          fiberSelfDurations: [1, 5],
          changeDescriptions: [
            [1, { props: ['onClick', 'className'], state: ['count'], isFirstMount: false }],
          ],
        },
        {
          timestamp: 2000,
          duration: 5,
          fiberActualDurations: [1, 5],
          fiberSelfDurations: [1, 5],
          changeDescriptions: [
            [1, { props: ['className', 'theme'], state: ['count'], hooks: [0, 2], isFirstMount: false }],
          ],
        },
      ],
    });

    const report = profiler.getReport(1, tree);
    expect(report).not.toBeNull();
    expect(report!.changedKeys!.props).toEqual(expect.arrayContaining(['onClick', 'className', 'theme']));
    expect(report!.changedKeys!.props).toHaveLength(3);
    expect(report!.changedKeys!.state).toEqual(['count']);
    expect(report!.changedKeys!.hooks).toEqual(expect.arrayContaining([0, 2]));
    expect(report!.changedKeys!.hooks).toHaveLength(2);
  });

  it('should find slowest components', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 15,
          fiberActualDurations: [1, 50, 2, 5, 3, 30],
          fiberSelfDurations: [1, 15, 2, 5, 3, 30],
        },
      ],
    });

    const slowest = profiler.getSlowest(tree, 2);
    expect(slowest).toHaveLength(2);
    expect(slowest[0].displayName).toBe('App');
    expect(slowest[1].displayName).toBe('Content');
  });

  it('should find most rerenders', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 5,
          fiberActualDurations: [1, 1, 2, 1, 3, 1],
          fiberSelfDurations: [1, 1, 2, 1, 3, 1],
        },
        {
          timestamp: 2000,
          duration: 5,
          fiberActualDurations: [2, 1, 3, 1],
          fiberSelfDurations: [2, 1, 3, 1],
        },
        {
          timestamp: 3000,
          duration: 5,
          fiberActualDurations: [3, 1],
          fiberSelfDurations: [3, 1],
        },
      ],
    });

    const rerenders = profiler.getMostRerenders(tree, 3);
    expect(rerenders[0].displayName).toBe('Content');
    expect(rerenders[0].renderCount).toBe(3);
  });

  it('should retain stored component metadata for offline reports', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 15,
          fiberActualDurations: [1, 10],
          fiberSelfDurations: [1, 5],
        },
      ],
    });

    profiler.setComponentMetadata(1, {
      label: '@c1',
      type: 'function',
      path: 'AppShell > Screen',
      source: { fileName: '/src/App.tsx', lineNumber: 10, columnNumber: 2 },
      sourceKey: '/src/App.tsx:10:2',
    });

    const report = profiler.getReport(1, new ComponentTree());
    expect(report).not.toBeNull();
    expect(report!.label).toBe('@c1');
    expect(report!.type).toBe('function');
    expect(report!.path).toBe('AppShell > Screen');
    expect(report!.sourceKey).toBe('/src/App.tsx:10:2');
  });

  it('should resolve profiled components by stored label after disconnect', () => {
    profiler.start('test');
    profiler.processProfilingData({
      commitData: [
        {
          timestamp: 1000,
          duration: 15,
          fiberActualDurations: [1, 10],
          fiberSelfDurations: [1, 5],
        },
      ],
    });

    profiler.setComponentMetadata(1, { label: '@c1' });

    expect(profiler.resolveProfiledComponentId('@c1')).toBe(1);
    expect(profiler.resolveProfiledComponentId('1')).toBe(1);
    expect(profiler.resolveProfiledComponentId('@c?(id:1)')).toBe(1);
    expect(profiler.resolveProfiledComponentId('@c9')).toBeUndefined();
  });

  it('should process dataForRoots nested format', () => {
    profiler.start('test');

    profiler.processProfilingData({
      dataForRoots: [
        {
          commitData: [
            {
              timestamp: 1000,
              duration: 12,
              fiberActualDurations: [1, 8, 2, 4],
              fiberSelfDurations: [1, 4, 2, 4],
              changeDescriptions: [
                [1, { props: ['count'], isFirstMount: false }],
                [2, { state: ['value'], isFirstMount: false }],
              ],
            },
          ],
        },
      ],
    });

    const summary = profiler.stop();
    expect(summary).not.toBeNull();
    expect(summary!.commitCount).toBe(1);

    // Verify the state change was captured correctly
    profiler.start('test2');
    profiler.processProfilingData({
      dataForRoots: [
        {
          commitData: [
            {
              timestamp: 2000,
              duration: 5,
              fiberActualDurations: [2, 3],
              fiberSelfDurations: [2, 3],
              changeDescriptions: [
                [2, { state: ['value', 'count'], isFirstMount: false }],
              ],
            },
          ],
        },
      ],
    });

    const report = profiler.getReport(2, tree);
    expect(report).not.toBeNull();
    expect(report!.causes).toContain('state-changed');
  });

  it('should generate timeline', () => {
    profiler.start('test');

    profiler.processProfilingData({
      commitData: [
        { timestamp: 1000, duration: 10, fiberActualDurations: [1, 5], fiberSelfDurations: [] },
        { timestamp: 2000, duration: 20, fiberActualDurations: [1, 10, 2, 5], fiberSelfDurations: [] },
      ],
    });

    const timeline = profiler.getTimeline();
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.total).toBe(2);
    expect(timeline.entries[0].duration).toBe(10);
    expect(timeline.entries[0].componentCount).toBe(1);
    expect(timeline.entries[1].duration).toBe(20);
    expect(timeline.entries[1].componentCount).toBe(2);
  });

  describe('getExportData', () => {
    it('returns null when no session exists', () => {
      expect(profiler.getExportData(tree)).toBeNull();
    });

    it('returns null when session has no commits', () => {
      profiler.start('test');
      profiler.stop();
      expect(profiler.getExportData(tree)).toBeNull();
    });

    it('exports version 5 format', () => {
      profiler.start('test');
      profiler.processProfilingData({
        commitData: [
          {
            timestamp: 1000,
            duration: 15,
            fiberActualDurations: [1, 10, 2, 3, 3, 2],
            fiberSelfDurations: [1, 5, 2, 3, 3, 2],
          },
        ],
      });
      profiler.stop(tree);

      const exported = profiler.getExportData(tree);
      expect(exported).not.toBeNull();
      expect(exported!.version).toBe(5);
      expect(exported!.dataForRoots).toHaveLength(1);
    });

    it('maps commits to CommitDataExport format', () => {
      profiler.start('test');
      profiler.processProfilingData({
        commitData: [
          {
            timestamp: 1000,
            duration: 15,
            fiberActualDurations: [1, 10, 2, 3],
            fiberSelfDurations: [1, 5, 2, 3],
            changeDescriptions: [
              [1, { props: ['theme'], isFirstMount: false }],
              [2, { isFirstMount: true }],
            ],
          },
        ],
      });
      profiler.stop(tree);

      const root = profiler.getExportData(tree)!.dataForRoots[0];
      expect(root.commitData).toHaveLength(1);

      const commit = root.commitData[0];
      expect(commit.timestamp).toBe(1000);
      expect(commit.duration).toBe(15);
      expect(commit.fiberActualDurations).toEqual(expect.arrayContaining([[1, 10], [2, 3]]));
      expect(commit.fiberSelfDurations).toEqual(expect.arrayContaining([[1, 5], [2, 3]]));
      expect(commit.effectDuration).toBe(0);
      expect(commit.passiveEffectDuration).toBe(0);
      expect(commit.priorityLevel).toBeNull();
      expect(commit.updaters).toBeNull();
    });

    it('exports change descriptions with context:null field', () => {
      profiler.start('test');
      profiler.processProfilingData({
        commitData: [
          {
            timestamp: 1000,
            duration: 5,
            fiberActualDurations: [1, 5],
            fiberSelfDurations: [1, 5],
            changeDescriptions: [
              [1, { props: ['onClick'], state: ['count'], isFirstMount: false, didHooksChange: true }],
            ],
          },
        ],
      });
      profiler.stop(tree);

      const commit = profiler.getExportData(tree)!.dataForRoots[0].commitData[0];
      expect(commit.changeDescriptions).toHaveLength(1);
      const [id, desc] = commit.changeDescriptions![0];
      expect(id).toBe(1);
      expect(desc.context).toBeNull();
      expect(desc.props).toEqual(['onClick']);
      expect(desc.state).toEqual(['count']);
      expect(desc.didHooksChange).toBe(true);
      expect(desc.isFirstMount).toBe(false);
    });

    it('builds snapshots from component tree', () => {
      profiler.start('test');
      profiler.processProfilingData({
        commitData: [
          {
            timestamp: 1000,
            duration: 5,
            fiberActualDurations: [1, 5],
            fiberSelfDurations: [1, 5],
          },
        ],
      });
      profiler.stop(tree);

      const root = profiler.getExportData(tree)!.dataForRoots[0];
      // Should have snapshots for all nodes in the tree
      expect(root.snapshots.length).toBeGreaterThanOrEqual(3); // App, Header, Content

      // Find the App snapshot
      const appSnapshot = root.snapshots.find(([id]) => id === 1);
      expect(appSnapshot).toBeDefined();
      const [, appNode] = appSnapshot!;
      expect(appNode.displayName).toBe('App');
      expect(appNode.type).toBe(5); // ElementType for function
      expect(appNode.children).toEqual(expect.arrayContaining([2, 3]));
      expect(appNode.compiledWithForget).toBe(false);
      expect(appNode.hocDisplayNames).toBeNull();
    });

    it('populates initialTreeBaseDurations for all tree nodes', () => {
      profiler.start('test');
      profiler.processProfilingData({
        commitData: [
          {
            timestamp: 1000,
            duration: 15,
            fiberActualDurations: [1, 10, 2, 3],
            fiberSelfDurations: [1, 5, 2, 3],
          },
          {
            timestamp: 2000,
            duration: 8,
            fiberActualDurations: [1, 6],
            fiberSelfDurations: [1, 4],
          },
        ],
      });
      profiler.stop(tree);

      const root = profiler.getExportData(tree)!.dataForRoots[0];
      // Should include ALL tree nodes, using latest self duration (0 for unrendered)
      expect(root.initialTreeBaseDurations).toEqual(expect.arrayContaining([
        [1, 4],  // latest from commit 2
        [2, 3],  // from commit 1 (not in commit 2)
        [3, 0],  // never rendered — defaults to 0
      ]));
    });

    it('produces JSON that can be serialized and parsed', () => {
      profiler.start('test');
      profiler.processProfilingData({
        commitData: [
          {
            timestamp: 1000,
            duration: 15,
            fiberActualDurations: [1, 10, 2, 3, 3, 2],
            fiberSelfDurations: [1, 5, 2, 3, 3, 2],
            changeDescriptions: [
              [1, { props: ['x'], isFirstMount: false }],
            ],
          },
        ],
      });
      profiler.stop(tree);

      const exported = profiler.getExportData(tree)!;
      const json = JSON.stringify(exported);
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(5);
      expect(parsed.dataForRoots).toHaveLength(1);
      expect(parsed.dataForRoots[0].commitData).toHaveLength(1);
    });
  });
});
