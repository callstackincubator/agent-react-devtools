import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentTree } from '../component-tree.js';

/**
 * Operations encoding reference (protocol v2):
 * [rendererID, rootFiberID, stringTableSize, ...stringTable, ...ops]
 *
 * String table: for each string, [length, ...charCodes]. String ID 0 = null.
 *
 * TREE_OPERATION_ADD (1):
 *   1, id, elementType, parentId, ownerID, displayNameStringID, keyStringID
 *
 * Element types (from react-devtools-shared/src/frontend/types.js):
 *   CLASS=1, FUNCTION=5, FORWARD_REF=6, HOST=7, MEMO=8, PROFILER=10, ROOT=11, SUSPENSE=12
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

function removeOp(...ids: number[]): number[] {
  return [2, ids.length, ...ids];
}

function reorderOp(id: number, children: number[]): number[] {
  return [3, id, children.length, ...children];
}

describe('ComponentTree', () => {
  let tree: ComponentTree;

  beforeEach(() => {
    tree = new ComponentTree();
  });

  it('should add nodes from operations', () => {
    const ops = buildOps(1, 100, ['App', 'Header', 'Footer'], (s) => [
      ...addOp(1, 5, 0, s('App')),     // Function component at root
      ...addOp(2, 8, 1, s('Header')),   // Memo child
      ...addOp(3, 5, 1, s('Footer')),   // Function child
    ]);

    tree.applyOperations(ops);

    expect(tree.getComponentCount()).toBe(3);

    const node1 = tree.getNode(1);
    expect(node1).toBeDefined();
    expect(node1!.displayName).toBe('App');
    expect(node1!.type).toBe('function');
    expect(node1!.children).toEqual([2, 3]);

    const node2 = tree.getNode(2);
    expect(node2!.displayName).toBe('Header');
    expect(node2!.type).toBe('memo');
    expect(node2!.parentId).toBe(1);
  });

  it('should handle keys', () => {
    const ops = buildOps(1, 100, ['List', 'Item', 'item-1', 'item-2'], (s) => [
      ...addOp(1, 5, 0, s('List')),
      ...addOp(2, 5, 1, s('Item'), s('item-1')),
      ...addOp(3, 5, 1, s('Item'), s('item-2')),
    ]);

    tree.applyOperations(ops);

    expect(tree.getNode(2)!.key).toBe('item-1');
    expect(tree.getNode(3)!.key).toBe('item-2');
  });

  it('should remove nodes', () => {
    const addOps = buildOps(1, 100, ['App', 'Child'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('Child')),
    ]);
    tree.applyOperations(addOps);
    expect(tree.getComponentCount()).toBe(2);

    // Remove ops still need a string table (can be empty)
    const rmOps = [1, 100, 0, ...removeOp(2)];
    tree.applyOperations(rmOps);
    expect(tree.getComponentCount()).toBe(1);
    expect(tree.getNode(1)!.children).toEqual([]);
  });

  it('should reorder children', () => {
    const ops = buildOps(1, 100, ['App', 'A', 'B', 'C'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('A')),
      ...addOp(3, 5, 1, s('B')),
      ...addOp(4, 5, 1, s('C')),
    ]);
    tree.applyOperations(ops);
    expect(tree.getNode(1)!.children).toEqual([2, 3, 4]);

    const reorderOps = [1, 100, 0, ...reorderOp(1, [4, 2, 3])];
    tree.applyOperations(reorderOps);
    expect(tree.getNode(1)!.children).toEqual([4, 2, 3]);
  });

  it('should find by name (partial match)', () => {
    const ops = buildOps(1, 100, ['App', 'UserProfile', 'UserCard', 'Footer'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('UserProfile')),
      ...addOp(3, 5, 1, s('UserCard')),
      ...addOp(4, 5, 1, s('Footer')),
    ]);
    tree.applyOperations(ops);

    const results = tree.findByName('user');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.displayName).sort()).toEqual([
      'UserCard',
      'UserProfile',
    ]);
  });

  it('should find by name (exact match)', () => {
    const ops = buildOps(1, 100, ['App', 'UserProfile', 'UserCard'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('UserProfile')),
      ...addOp(3, 5, 1, s('UserCard')),
    ]);
    tree.applyOperations(ops);

    const results = tree.findByName('UserProfile', true);
    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe('UserProfile');
  });

  it('should get count by type', () => {
    const ops = buildOps(1, 100, ['App', 'MemoComp', 'FuncComp', 'div'], (s) => [
      ...addOp(1, 5, 0, s('App')),       // function
      ...addOp(2, 8, 1, s('MemoComp')),   // memo
      ...addOp(3, 5, 1, s('FuncComp')),   // function
      ...addOp(4, 7, 1, s('div')),        // host
    ]);
    tree.applyOperations(ops);

    const counts = tree.getCountByType();
    expect(counts['function']).toBe(2);
    expect(counts['memo']).toBe(1);
    expect(counts['host']).toBe(1);
  });

  it('should get tree with depth limit', () => {
    const ops = buildOps(1, 100, ['App', 'Level1', 'Level2', 'Level3'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('Level1')),
      ...addOp(3, 5, 2, s('Level2')),
      ...addOp(4, 5, 3, s('Level3')),
    ]);
    tree.applyOperations(ops);

    const fullTree = tree.getTree();
    expect(fullTree).toHaveLength(4);

    const shallow = tree.getTree(1);
    expect(shallow).toHaveLength(2);
    expect(shallow.map((n) => n.displayName)).toEqual(['App', 'Level1']);
  });

  it('should build parent path strings', () => {
    const ops = buildOps(1, 100, ['App', 'SearchPage', 'FiltersPanel', 'Context.Provider'], (s) => [
      ...addOp(1, 5, 0, s('App')),
      ...addOp(2, 5, 1, s('SearchPage')),
      ...addOp(3, 5, 2, s('FiltersPanel')),
      ...addOp(4, 5, 3, s('Context.Provider')),
    ]);
    tree.applyOperations(ops);

    expect(tree.getPathString(4)).toBe('App > SearchPage > FiltersPanel');
    expect(tree.getPathString(4, true)).toBe('App > SearchPage > FiltersPanel > Context.Provider');
    expect(tree.getPathString(4, false, 2)).toBe('SearchPage > FiltersPanel');
    expect(tree.getPathString(1)).toBeUndefined();
  });

  describe('subtree extraction (rootId)', () => {
    it('should get subtree from a specific root', () => {
      const ops = buildOps(1, 100, ['App', 'Header', 'Nav', 'Logo', 'Footer'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Header')),
        ...addOp(3, 5, 2, s('Nav')),
        ...addOp(4, 5, 2, s('Logo')),
        ...addOp(5, 5, 1, s('Footer')),
      ]);
      tree.applyOperations(ops);

      const subtree = tree.getTree({ rootId: 2 });
      expect(subtree).toHaveLength(3);
      expect(subtree.map((n) => n.displayName)).toEqual(['Header', 'Nav', 'Logo']);
      expect(subtree[0].depth).toBe(0);
      expect(subtree[0].parentId).toBeNull();
      expect(subtree[1].depth).toBe(1);
      expect(subtree[2].depth).toBe(1);
    });

    it('should get subtree with depth limit', () => {
      const ops = buildOps(1, 100, ['App', 'Header', 'Nav', 'Link', 'Footer'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Header')),
        ...addOp(3, 5, 2, s('Nav')),
        ...addOp(4, 5, 3, s('Link')),
        ...addOp(5, 5, 1, s('Footer')),
      ]);
      tree.applyOperations(ops);

      const subtree = tree.getTree({ rootId: 2, maxDepth: 1 });
      expect(subtree).toHaveLength(2);
      expect(subtree.map((n) => n.displayName)).toEqual(['Header', 'Nav']);
    });

    it('should return empty array for non-existent subtree root', () => {
      const ops = buildOps(1, 100, ['App'], (s) => [
        ...addOp(1, 5, 0, s('App')),
      ]);
      tree.applyOperations(ops);

      const subtree = tree.getTree({ rootId: 999 });
      expect(subtree).toHaveLength(0);
    });

    it('should assign labels starting from @c1 in subtree', () => {
      const ops = buildOps(1, 100, ['App', 'Header', 'Nav'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Header')),
        ...addOp(3, 5, 2, s('Nav')),
      ]);
      tree.applyOperations(ops);

      const subtree = tree.getTree({ rootId: 2 });
      expect(subtree[0].label).toBe('@c1');
      expect(subtree[1].label).toBe('@c2');
    });

    it('should combine rootId with noHost', () => {
      const ops = buildOps(1, 100, ['App', 'Header', 'div', 'Nav'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Header')),
        ...addOp(3, 7, 2, s('div')),
        ...addOp(4, 5, 3, s('Nav')),
      ]);
      tree.applyOperations(ops);

      const subtree = tree.getTree({ rootId: 2, noHost: true });
      expect(subtree.map((n) => n.displayName)).toEqual(['Header', 'Nav']);
    });
  });

  it('should handle empty operations', () => {
    tree.applyOperations([]);
    expect(tree.getComponentCount()).toBe(0);

    tree.applyOperations([1]);
    expect(tree.getComponentCount()).toBe(0);
  });

  it('should handle all element types', () => {
    const ops = buildOps(
      1, 100,
      ['ClassComp', 'FuncComp', 'ForwardRefComp', 'HostComp', 'MemoComp', 'ProfilerComp', 'SuspenseComp'],
      (s) => [
        ...addOp(1, 1, 0, s('ClassComp')),       // class = 1
        ...addOp(2, 5, 1, s('FuncComp')),         // function = 5
        ...addOp(3, 6, 1, s('ForwardRefComp')),   // forwardRef = 6
        ...addOp(4, 7, 1, s('HostComp')),         // host = 7
        ...addOp(5, 8, 1, s('MemoComp')),         // memo = 8
        ...addOp(6, 10, 1, s('ProfilerComp')),    // profiler = 10
        ...addOp(7, 12, 1, s('SuspenseComp')),    // suspense = 12
      ],
    );
    tree.applyOperations(ops);

    expect(tree.getNode(1)!.type).toBe('class');
    expect(tree.getNode(2)!.type).toBe('function');
    expect(tree.getNode(3)!.type).toBe('forwardRef');
    expect(tree.getNode(4)!.type).toBe('host');
    expect(tree.getNode(5)!.type).toBe('memo');
    expect(tree.getNode(6)!.type).toBe('profiler');
    expect(tree.getNode(7)!.type).toBe('suspense');
  });

  describe('UPDATE_ERRORS_OR_WARNINGS', () => {
    it('should store error and warning counts on nodes', () => {
      const ops = buildOps(1, 100, ['App', 'Form'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Form')),
      ]);
      tree.applyOperations(ops);

      // Operation type 5 = UPDATE_ERRORS_OR_WARNINGS: opcode, id, numErrors, numWarnings
      const errorOps = [1, 100, 0, 5, 2, 1, 3];
      tree.applyOperations(errorOps);

      const node = tree.getNode(2);
      expect(node).toBeDefined();
      expect(node!.errors).toBe(1);
      expect(node!.warnings).toBe(3);

      // App should still have zero counts
      expect(tree.getNode(1)!.errors).toBe(0);
      expect(tree.getNode(1)!.warnings).toBe(0);
    });

    it('should update counts when a second errors operation arrives', () => {
      const ops = buildOps(1, 100, ['App'], (s) => [
        ...addOp(1, 5, 0, s('App')),
      ]);
      tree.applyOperations(ops);

      tree.applyOperations([1, 100, 0, 5, 1, 2, 0]);
      expect(tree.getNode(1)!.errors).toBe(2);
      expect(tree.getNode(1)!.warnings).toBe(0);

      // Counts are replaced, not accumulated
      tree.applyOperations([1, 100, 0, 5, 1, 0, 5]);
      expect(tree.getNode(1)!.errors).toBe(0);
      expect(tree.getNode(1)!.warnings).toBe(5);
    });

    it('should initialize errors and warnings to zero', () => {
      const ops = buildOps(1, 100, ['App'], (s) => [
        ...addOp(1, 5, 0, s('App')),
      ]);
      tree.applyOperations(ops);

      expect(tree.getNode(1)!.errors).toBe(0);
      expect(tree.getNode(1)!.warnings).toBe(0);
    });
  });

  describe('getComponentsWithErrorsOrWarnings', () => {
    it('should return only components with non-zero errors or warnings', () => {
      const ops = buildOps(1, 100, ['App', 'Form', 'Button'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Form')),
        ...addOp(3, 5, 1, s('Button')),
      ]);
      tree.applyOperations(ops);

      // Give Form errors and Button warnings
      tree.applyOperations([1, 100, 0, 5, 2, 3, 0]);  // Form: 3 errors
      tree.applyOperations([1, 100, 0, 5, 3, 0, 2]);  // Button: 2 warnings

      // Need to call getTree first to assign labels
      tree.getTree();

      const results = tree.getComponentsWithErrorsOrWarnings();
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.displayName).sort()).toEqual(['Button', 'Form']);

      const form = results.find((r) => r.displayName === 'Form')!;
      expect(form.errors).toBe(3);
      expect(form.warnings).toBeUndefined();

      const button = results.find((r) => r.displayName === 'Button')!;
      expect(button.errors).toBeUndefined();
      expect(button.warnings).toBe(2);
    });

    it('should return empty array when no components have errors', () => {
      const ops = buildOps(1, 100, ['App'], (s) => [
        ...addOp(1, 5, 0, s('App')),
      ]);
      tree.applyOperations(ops);

      tree.getTree();
      const results = tree.getComponentsWithErrorsOrWarnings();
      expect(results).toHaveLength(0);
    });
  });

  describe('tree output includes error annotations', () => {
    it('should include errors/warnings on tree nodes when non-zero', () => {
      const ops = buildOps(1, 100, ['App', 'Form'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 5, 1, s('Form')),
      ]);
      tree.applyOperations(ops);

      tree.applyOperations([1, 100, 0, 5, 2, 1, 2]);

      const treeNodes = tree.getTree();
      const formNode = treeNodes.find((n) => n.displayName === 'Form')!;
      expect(formNode.errors).toBe(1);
      expect(formNode.warnings).toBe(2);

      // App has no errors/warnings, so they should be omitted
      const appNode = treeNodes.find((n) => n.displayName === 'App')!;
      expect(appNode.errors).toBeUndefined();
      expect(appNode.warnings).toBeUndefined();
    });
  });

  describe('host filtering (noHost)', () => {
    it('should filter out plain host components', () => {
      const ops = buildOps(1, 100, ['App', 'div', 'span', 'Header'], (s) => [
        ...addOp(1, 5, 0, s('App')),       // function
        ...addOp(2, 7, 1, s('div')),        // host
        ...addOp(3, 5, 2, s('Header')),     // function inside div
        ...addOp(4, 7, 1, s('span')),       // host
      ]);
      tree.applyOperations(ops);
      expect(tree.getComponentCount()).toBe(4);

      const filtered = tree.getTree({ noHost: true });
      const names = filtered.map((n) => n.displayName);
      expect(names).toEqual(['App', 'Header']);
    });

    it('should keep host components with keys', () => {
      const ops = buildOps(1, 100, ['App', 'li', 'item-1'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 7, 1, s('li'), s('item-1')), // host with key
      ]);
      tree.applyOperations(ops);

      const filtered = tree.getTree({ noHost: true });
      expect(filtered.map((n) => n.displayName)).toEqual(['App', 'li']);
    });

    it('should keep custom elements (names with hyphens)', () => {
      const ops = buildOps(1, 100, ['App', 'my-component'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 7, 1, s('my-component')), // custom element
      ]);
      tree.applyOperations(ops);

      const filtered = tree.getTree({ noHost: true });
      expect(filtered.map((n) => n.displayName)).toEqual(['App', 'my-component']);
    });

    it('should promote children of filtered host nodes', () => {
      // App > div > Header (div should be filtered, Header promoted)
      const ops = buildOps(1, 100, ['App', 'div', 'Header'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 7, 1, s('div')),
        ...addOp(3, 5, 2, s('Header')),
      ]);
      tree.applyOperations(ops);

      const filtered = tree.getTree({ noHost: true });
      expect(filtered).toHaveLength(2);
      // Header should now show App as parent
      const header = filtered.find((n) => n.displayName === 'Header')!;
      expect(header.parentId).toBe(1); // promoted to App
    });

    it('should include all nodes when noHost is false', () => {
      const ops = buildOps(1, 100, ['App', 'div', 'Header'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 7, 1, s('div')),
        ...addOp(3, 5, 2, s('Header')),
      ]);
      tree.applyOperations(ops);

      const unfiltered = tree.getTree({ noHost: false });
      expect(unfiltered).toHaveLength(3);
    });

    it('should combine noHost with maxDepth', () => {
      const ops = buildOps(1, 100, ['App', 'div', 'Header', 'Deep'], (s) => [
        ...addOp(1, 5, 0, s('App')),
        ...addOp(2, 7, 1, s('div')),
        ...addOp(3, 5, 2, s('Header')),
        ...addOp(4, 5, 3, s('Deep')),
      ]);
      tree.applyOperations(ops);

      // With noHost, div is skipped so Header is at depth 1, Deep at depth 2
      const filtered = tree.getTree({ noHost: true, maxDepth: 1 });
      expect(filtered.map((n) => n.displayName)).toEqual(['App', 'Header']);
    });
  });
});

describe('ComponentTree.reconcileReflushedRoot', () => {
  const ROOT_OP = (id: number) => [1, id, 11, 0, 1, 0, 0];

  function fullTree(rendererId: number, rootId: number, base: number): number[] {
    return buildOps(rendererId, rootId, ['App', 'Header', 'Item'], (strId) => [
      ...ROOT_OP(rootId),
      ...addOp(base + 1, 5, rootId, strId('App')),
      ...addOp(base + 2, 8, base + 1, strId('Header')),
      ...addOp(base + 3, 5, base + 1, strId('Item')),
      ...addOp(base + 4, 5, base + 1, strId('Item')),
    ]);
  }

  it('drops the older root when a new root of the same renderer duplicates it', () => {
    const tree = new ComponentTree();
    tree.applyOperations(fullTree(1, 100, 0));
    expect(tree.getComponentCount()).toBe(5);

    // Another backend attached: same fibers re-flushed under a fresh ID space
    tree.applyOperations(fullTree(1, 500, 1000));
    expect(tree.getComponentCount()).toBe(10);

    expect(tree.reconcileReflushedRoot(500)).toBe(100);
    expect(tree.getComponentCount()).toBe(5);
    expect(tree.getRootIds()).toEqual([500]);
    expect(tree.getNode(1)).toBeUndefined();
    expect(tree.getNode(1001)?.displayName).toBe('App');
    expect(tree.findByName('Item', true)).toHaveLength(2);
  });

  it('keeps a genuine second root whose structure differs', () => {
    const tree = new ComponentTree();
    tree.applyOperations(fullTree(1, 100, 0));
    tree.applyOperations(
      buildOps(1, 500, ['Sidebar'], (strId) => [
        ...ROOT_OP(500),
        ...addOp(1001, 5, 500, strId('Sidebar')),
      ]),
    );

    expect(tree.reconcileReflushedRoot(500)).toBeNull();
    expect(tree.getRootIds()).toEqual([100, 500]);
    expect(tree.getComponentCount()).toBe(7);
  });

  it('never matches roots across renderers', () => {
    const tree = new ComponentTree();
    tree.applyOperations(fullTree(1, 100, 0));
    tree.applyOperations(fullTree(2, 500, 1000));

    expect(tree.reconcileReflushedRoot(500)).toBeNull();
    expect(tree.getComponentCount()).toBe(10);
  });

  it('only considers roots added before the reflushed one', () => {
    const tree = new ComponentTree();
    tree.applyOperations(fullTree(1, 100, 0));
    tree.applyOperations(fullTree(1, 500, 1000));

    // Asking about the older root must not delete the newer, live one
    expect(tree.reconcileReflushedRoot(100)).toBeNull();
    expect(tree.getRootIds()).toEqual([100, 500]);
  });
});
