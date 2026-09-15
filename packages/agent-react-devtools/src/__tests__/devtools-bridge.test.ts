import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevToolsBridge } from '../devtools-bridge.js';
import { ComponentTree } from '../component-tree.js';
import { Profiler } from '../profiler.js';

function buildStringTable(strings: string[]): [number[], Map<string, number>] {
  const idMap = new Map<string, number>();
  const data: number[] = [];
  for (const s of strings) {
    const id = idMap.size + 1;
    if (!idMap.has(s)) {
      idMap.set(s, id);
      data.push(s.length, ...Array.from(s).map((c) => c.charCodeAt(0)));
    }
  }
  return [data, idMap];
}

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
): number[] {
  return [1, id, elementType, parentId, 0, displayNameStrId, 0];
}

describe('DevToolsBridge', () => {
  let tree: ComponentTree;
  let bridge: DevToolsBridge;

  beforeEach(() => {
    tree = new ComponentTree();
    bridge = new DevToolsBridge(8097, tree, new Profiler());

    const ops = buildOps(1, 100, ['App'], (s) => [
      ...addOp(1, 5, 0, s('App')),
    ]);
    tree.applyOperations(ops);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves source metadata from inspected element payloads', async () => {
    const pending = new Promise((resolve) => {
      (bridge as any).pendingInspections.set(123, {
        id: 1,
        resolve,
        timer: setTimeout(() => {}, 1000),
      });
    });

    (bridge as any).handleInspectedElement({
      type: 'full-data',
      id: 1,
      responseID: 123,
      value: {
        id: 1,
        displayName: 'App',
        type: 5,
        key: null,
        props: {},
        state: null,
        hooks: null,
        source: {
          fileName: '/src/App.tsx',
          lineNumber: 10,
          columnNumber: 4,
        },
      },
    });

    await expect(pending).resolves.toMatchObject({
      source: {
        fileName: '/src/App.tsx',
        lineNumber: 10,
        columnNumber: 4,
      },
    });
  });

  it('keeps inspection working when source metadata is missing', async () => {
    const pending = new Promise((resolve) => {
      (bridge as any).pendingInspections.set(123, {
        id: 1,
        resolve,
        timer: setTimeout(() => {}, 1000),
      });
    });

    (bridge as any).handleInspectedElement({
      type: 'full-data',
      id: 1,
      responseID: 123,
      value: {
        id: 1,
        displayName: 'App',
        type: 5,
        key: null,
        props: { count: 1 },
        state: null,
        hooks: null,
      },
    });

    await expect(pending).resolves.toMatchObject({
      displayName: 'App',
      props: { count: 1 },
      source: undefined,
    });
  });

  it('returns cached inspection data without a live connection', async () => {
    (bridge as any).inspectionCache.set(1, {
      id: 1,
      displayName: 'App',
      type: 'function',
      key: null,
      props: { cached: true },
      state: null,
      hooks: null,
      renderedAt: null,
      source: undefined,
    });

    await expect(bridge.inspectElement(1)).resolves.toMatchObject({
      props: { cached: true },
    });
  });

  it('supports concurrent inspections for the same component id', async () => {
    const sent: Array<{ event: string; payload: { requestID: number } }> = [];
    (bridge as any).connections.add({});
    (bridge as any).sendToAll = (msg: { event: string; payload: { requestID: number } }) => {
      sent.push(msg);
    };

    const first = bridge.inspectElement(1);
    const second = bridge.inspectElement(1);

    expect(sent).toHaveLength(2);
    expect(sent[0].payload.requestID).not.toBe(sent[1].payload.requestID);
    expect((bridge as any).pendingInspections.size).toBe(2);

    (bridge as any).handleInspectedElement({
      type: 'full-data',
      id: 1,
      responseID: sent[0].payload.requestID,
      value: {
        id: 1,
        displayName: 'App',
        type: 5,
        key: null,
        props: { source: 'first' },
        state: null,
        hooks: null,
      },
    });
    (bridge as any).handleInspectedElement({
      type: 'full-data',
      id: 1,
      responseID: sent[1].payload.requestID,
      value: {
        id: 1,
        displayName: 'App',
        type: 5,
        key: null,
        props: { source: 'second' },
        state: null,
        hooks: null,
      },
    });

    await expect(first).resolves.toMatchObject({ props: { source: 'first' } });
    await expect(second).resolves.toMatchObject({ props: { source: 'second' } });
  });
});
