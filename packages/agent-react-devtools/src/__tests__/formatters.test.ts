import { describe, it, expect } from 'vitest';
import {
  formatTree,
  formatComponent,
  formatSearchResults,
  formatCount,
  formatErrors,
  formatStatus,
  formatAgo,
  formatProfileSummary,
  formatProfileReport,
  formatSlowest,
  formatRerenders,
  formatTimeline,
  formatCommitDetail,
  formatChangedKeys,
} from '../formatters.js';
import type { TreeNode } from '../component-tree.js';
import type { InspectedElement, StatusInfo, ComponentRenderReport, ConnectionHealth, ChangedKeys } from '../types.js';
import type { ProfileSummary, TimelineResult, CommitDetail } from '../profiler.js';

describe('formatTree', () => {
  it('should format empty tree', () => {
    expect(formatTree([])).toContain('No components');
    expect(formatTree([])).toContain('is a React app connected?');
  });

  it('should show hint when provided for empty tree', () => {
    const result = formatTree([], 'app disconnected 5s ago, waiting for reconnect...');
    expect(result).toBe('No components (app disconnected 5s ago, waiting for reconnect...)');
  });

  it('should format a simple tree', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'App', type: 'function', key: null, parentId: null, children: [2, 3], depth: 0 },
      { id: 2, label: '@c2', displayName: 'Header', type: 'memo', key: null, parentId: 1, children: [], depth: 1 },
      { id: 3, label: '@c3', displayName: 'Footer', type: 'host', key: null, parentId: 1, children: [], depth: 1 },
    ];

    const result = formatTree(nodes);
    expect(result).toContain('@c1 [fn] App');
    expect(result).toContain('@c2 [memo] Header');
    expect(result).toContain('@c3 [host] Footer');
    expect(result).toContain('├─');
    expect(result).toContain('└─');
  });

  it('should format a subtree (root has null parentId)', () => {
    const nodes: TreeNode[] = [
      { id: 5, label: '@c1', displayName: 'Header', type: 'function', key: null, parentId: null, children: [6, 7], depth: 0 },
      { id: 6, label: '@c2', displayName: 'Nav', type: 'function', key: null, parentId: 5, children: [], depth: 1 },
      { id: 7, label: '@c3', displayName: 'Logo', type: 'memo', key: null, parentId: 5, children: [], depth: 1 },
    ];

    const result = formatTree(nodes);
    expect(result).toContain('@c1 [fn] Header');
    expect(result).toContain('@c2 [fn] Nav');
    expect(result).toContain('@c3 [memo] Logo');
    expect(result).toContain('├─');
    expect(result).toContain('└─');
  });

  it('should show keys', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'List', type: 'function', key: null, parentId: null, children: [2], depth: 0 },
      { id: 2, label: '@c2', displayName: 'Item', type: 'function', key: 'item-1', parentId: 1, children: [], depth: 1 },
    ];

    const result = formatTree(nodes);
    expect(result).toContain('key=item-1');
  });

  it('should accept hint via options object', () => {
    const result = formatTree([], { hint: 'custom hint' });
    expect(result).toBe('No components (custom hint)');
  });

  it('should collapse repeated siblings', () => {
    const children: number[] = [];
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'List', type: 'function', key: null, parentId: null, children: [], depth: 0 },
    ];
    // Add 6 TodoItem children
    for (let i = 0; i < 6; i++) {
      const childId = 10 + i;
      children.push(childId);
      nodes.push({
        id: childId,
        label: `@c${2 + i}`,
        displayName: 'TodoItem',
        type: 'function',
        key: String(i + 1),
        parentId: 1,
        children: [],
        depth: 1,
      });
    }
    nodes[0].children = children;

    const result = formatTree(nodes);
    // Should show first 3 items
    expect(result).toContain('@c2 [fn] TodoItem key=1');
    expect(result).toContain('@c3 [fn] TodoItem key=2');
    expect(result).toContain('@c4 [fn] TodoItem key=3');
    // Should collapse the rest
    expect(result).toContain('... +3 more TodoItem');
    // Should NOT show the 4th, 5th, 6th items as individual lines
    expect(result).not.toContain('@c5 [fn] TodoItem key=4');
  });

  it('should not collapse when siblings are 3 or fewer', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'List', type: 'function', key: null, parentId: null, children: [2, 3, 4], depth: 0 },
      { id: 2, label: '@c2', displayName: 'Item', type: 'function', key: '1', parentId: 1, children: [], depth: 1 },
      { id: 3, label: '@c3', displayName: 'Item', type: 'function', key: '2', parentId: 1, children: [], depth: 1 },
      { id: 4, label: '@c4', displayName: 'Item', type: 'function', key: '3', parentId: 1, children: [], depth: 1 },
    ];

    const result = formatTree(nodes);
    expect(result).not.toContain('more');
    expect(result).toContain('@c2');
    expect(result).toContain('@c3');
    expect(result).toContain('@c4');
  });

  it('should show summary footer with totalCount', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'App', type: 'function', key: null, parentId: null, children: [], depth: 0 },
    ];

    const result = formatTree(nodes, { totalCount: 500 });
    expect(result).toContain('1 components shown (500 total)');
  });

  it('should show simple count when all components are shown', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'App', type: 'function', key: null, parentId: null, children: [], depth: 0 },
    ];

    const result = formatTree(nodes, { totalCount: 1 });
    expect(result).toContain('1 components');
    expect(result).not.toContain('total');
  });

  it('should truncate output with maxLines', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'App', type: 'function', key: null, parentId: null, children: [2, 3, 4, 5, 6], depth: 0 },
      { id: 2, label: '@c2', displayName: 'A', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 3, label: '@c3', displayName: 'B', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 4, label: '@c4', displayName: 'C', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 5, label: '@c5', displayName: 'D', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 6, label: '@c6', displayName: 'E', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
    ];

    const result = formatTree(nodes, { maxLines: 3 });
    const lines = result.split('\n');
    // 3 content lines + truncation notice
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(result).toContain('truncated at 3 lines');
  });

  it('should combine maxLines with totalCount footer', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'App', type: 'function', key: null, parentId: null, children: [2, 3, 4], depth: 0 },
      { id: 2, label: '@c2', displayName: 'A', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 3, label: '@c3', displayName: 'B', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 4, label: '@c4', displayName: 'C', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
    ];

    const result = formatTree(nodes, { maxLines: 3, totalCount: 100 });
    // Truncation notice and total count are combined into one line (preserves content lines)
    expect(result).toContain('truncated');
    expect(result).toContain('100 total components');
  });
});

describe('formatComponent', () => {
  it('should format an inspected element', () => {
    const element: InspectedElement = {
      id: 5,
      displayName: 'UserProfile',
      type: 'function',
      key: null,
      props: { userId: 42, theme: 'dark' },
      state: { isEditing: false },
      hooks: [
        { name: 'useState', value: false },
        { name: 'useEffect', value: undefined },
        { name: 'useCallback', value: 'ƒ' },
      ],
      renderedAt: null,
    };

    const result = formatComponent(element, '@c5');
    expect(result).toContain('@c5 [fn] UserProfile');
    expect(result).toContain('props:');
    expect(result).toContain('  userId: 42');
    expect(result).toContain('  theme: "dark"');
    expect(result).toContain('state:');
    expect(result).toContain('  isEditing: false');
    expect(result).toContain('hooks:');
    expect(result).toContain('  useState: false');
  });

  it('should show key without quotes', () => {
    const element: InspectedElement = {
      id: 5,
      displayName: 'Item',
      type: 'function',
      key: 'abc',
      props: {},
      state: null,
      hooks: null,
      renderedAt: null,
    };

    const result = formatComponent(element, '@c5');
    expect(result).toContain('key=abc');
    expect(result).not.toContain('key="abc"');
  });
});

describe('formatSearchResults', () => {
  it('should format empty results', () => {
    expect(formatSearchResults([])).toContain('No components found');
  });

  it('should format results', () => {
    const results: TreeNode[] = [
      { id: 2, label: '@c2', displayName: 'UserProfile', type: 'function', key: null, parentId: 1, children: [], depth: 1 },
      { id: 3, label: '@c3', displayName: 'UserCard', type: 'memo', key: 'bob', parentId: 1, children: [], depth: 1 },
    ];

    const result = formatSearchResults(results);
    expect(result).toContain('@c2 [fn] UserProfile');
    expect(result).toContain('@c3 [memo] UserCard');
    expect(result).toContain('key=bob');
  });
});

describe('formatCount', () => {
  it('should format component counts', () => {
    const counts = { function: 10, memo: 3, host: 25 };
    const result = formatCount(counts);
    expect(result).toContain('38 components');
    expect(result).toContain('host:25');
    expect(result).toContain('fn:10');
    expect(result).toContain('memo:3');
  });
});

describe('formatStatus', () => {
  const baseConnection: ConnectionHealth = {
    connectedApps: 1,
    hasEverConnected: true,
    lastDisconnectAt: null,
    recentEvents: [],
  };

  it('should format status info', () => {
    const status: StatusInfo = {
      daemonRunning: true,
      port: 8097,
      connectedApps: 1,
      componentCount: 47,
      profilingActive: false,
      uptime: 12000,
      connection: baseConnection,
    };

    const result = formatStatus(status);
    expect(result).toContain('running');
    expect(result).toContain('8097');
    expect(result).toContain('1 connected');
    expect(result).toContain('47 components');
  });

  it('should show last connection event', () => {
    const now = Date.now();
    const status: StatusInfo = {
      daemonRunning: true,
      port: 8097,
      connectedApps: 1,
      componentCount: 10,
      profilingActive: false,
      uptime: 5000,
      connection: {
        ...baseConnection,
        recentEvents: [
          { type: 'connected', timestamp: now - 3000 },
        ],
      },
    };

    const result = formatStatus(status);
    expect(result).toContain('Last event: app connected 3s ago');
  });

  it('should show reconnected event', () => {
    const now = Date.now();
    const status: StatusInfo = {
      daemonRunning: true,
      port: 8097,
      connectedApps: 1,
      componentCount: 10,
      profilingActive: false,
      uptime: 5000,
      connection: {
        ...baseConnection,
        recentEvents: [
          { type: 'disconnected', timestamp: now - 4000 },
          { type: 'reconnected', timestamp: now - 2000 },
        ],
      },
    };

    const result = formatStatus(status);
    expect(result).toContain('Last event: app reconnected 2s ago');
  });

  it('should not show events line when no events', () => {
    const status: StatusInfo = {
      daemonRunning: true,
      port: 8097,
      connectedApps: 0,
      componentCount: 0,
      profilingActive: false,
      uptime: 1000,
      connection: baseConnection,
    };

    const result = formatStatus(status);
    expect(result).not.toContain('Last event');
  });
});

describe('formatProfileSummary', () => {
  it('should format summary with labels and types', () => {
    const summary: ProfileSummary = {
      name: 'test-session',
      duration: 5000,
      commitCount: 3,
      componentRenderCounts: [
        { id: 1, displayName: 'App', label: '@c1', type: 'function', count: 10 },
        { id: 2, displayName: 'Header', label: '@c2', type: 'memo', count: 5 },
      ],
    };

    const result = formatProfileSummary(summary);
    expect(result).toContain('test-session');
    expect(result).toContain('5.0s');
    expect(result).toContain('3 commits');
    expect(result).toContain('@c1 [fn] App');
    expect(result).toContain('10 renders');
    expect(result).toContain('@c2 [memo] Header');
    expect(result).toContain('5 renders');
  });

  it('should fallback for missing labels', () => {
    const summary: ProfileSummary = {
      name: 'sess',
      duration: 1000,
      commitCount: 1,
      componentRenderCounts: [
        { id: 1, displayName: 'App', count: 3 },
      ],
    };

    const result = formatProfileSummary(summary);
    expect(result).toContain('? [?] App');
  });
});

describe('formatProfileReport', () => {
  it('should format a render report with changed keys', () => {
    const report: ComponentRenderReport = {
      id: 5,
      displayName: 'UserProfile',
      label: '@c5',
      type: 'function',
      renderCount: 12,
      totalDuration: 540,
      avgDuration: 45,
      maxDuration: 120,
      causes: ['props-changed', 'state-changed'],
      changedKeys: { props: ['userId', 'theme'], state: ['isEditing'], hooks: [] },
    };

    const result = formatProfileReport(report);
    expect(result).toContain('@c5 [fn] UserProfile');
    expect(result).toContain('renders:12');
    expect(result).toContain('avg:45.0ms');
    expect(result).toContain('max:120.0ms');
    expect(result).toContain('props-changed');
    expect(result).toContain('changed: props: userId, theme  state: isEditing');
  });

  it('should omit changed line when keys are empty', () => {
    const report: ComponentRenderReport = {
      id: 5,
      displayName: 'UserProfile',
      renderCount: 1,
      totalDuration: 10,
      avgDuration: 10,
      maxDuration: 10,
      causes: ['first-mount'],
      changedKeys: { props: [], state: [], hooks: [] },
    };

    const result = formatProfileReport(report, '@c5');
    expect(result).not.toContain('changed:');
  });

  it('should prefer explicit label param over report.label', () => {
    const report: ComponentRenderReport = {
      id: 5,
      displayName: 'UserProfile',
      label: '@c5',
      type: 'function',
      renderCount: 1,
      totalDuration: 10,
      avgDuration: 10,
      maxDuration: 10,
      causes: [],
    };

    const result = formatProfileReport(report, '@c99');
    expect(result).toContain('@c99 [fn] UserProfile');
  });

  it('should show path and source context when available', () => {
    const report: ComponentRenderReport = {
      id: 5,
      displayName: 'UserProfile',
      label: '@c5',
      type: 'function',
      path: 'App > SettingsPage',
      source: { fileName: '/src/components/UserProfile.tsx', lineNumber: 12, columnNumber: 3 },
      renderCount: 2,
      totalDuration: 20,
      avgDuration: 10,
      maxDuration: 12,
      causes: ['props-changed'],
    };

    const result = formatProfileReport(report);
    expect(result).toContain('path: App > SettingsPage');
    expect(result).toContain('src: UserProfile.tsx:12:3');
  });
});

describe('formatSlowest', () => {
  it('should format empty data', () => {
    expect(formatSlowest([])).toContain('No profiling data');
  });

  it('should format slowest components with labels and changed keys', () => {
    const reports: ComponentRenderReport[] = [
      { id: 1, displayName: 'SlowComp', label: '@c1', type: 'function', renderCount: 5, totalDuration: 250, avgDuration: 50, maxDuration: 100, causes: ['props-changed', 'state-changed'], changedKeys: { props: ['data'], state: ['count'], hooks: [] } },
      { id: 2, displayName: 'FastComp', label: '@c2', type: 'memo', renderCount: 10, totalDuration: 100, avgDuration: 10, maxDuration: 20, causes: ['state-changed'], changedKeys: { props: [], state: ['count'], hooks: [] } },
    ];

    const result = formatSlowest(reports);
    expect(result).toContain('Slowest');
    expect(result).toContain('@c1 [fn] SlowComp');
    expect(result).toContain('@c2 [memo] FastComp');
    expect(result).toContain('causes:props-changed, state-changed');
    expect(result).toContain('changed: props: data  state: count');
    expect(result).toContain('changed: state: count');
  });

  it('should group rows with the same display name and source', () => {
    const reports: ComponentRenderReport[] = [
      {
        id: 1,
        displayName: 'Context.Provider',
        label: '@c1',
        type: 'other',
        path: 'App > SearchPage > FiltersPanel',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 5,
        totalDuration: 25,
        avgDuration: 5,
        maxDuration: 10,
        causes: ['parent-rendered'],
      },
      {
        id: 2,
        displayName: 'Context.Provider',
        label: '@c2',
        type: 'other',
        path: 'App > SearchPage > ResultsPanel',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 5,
        totalDuration: 20,
        avgDuration: 4,
        maxDuration: 8,
        causes: ['parent-rendered'],
      },
    ];

    const result = formatSlowest(reports);
    expect(result).toContain('Context.Provider  2 instances  src: SearchContext.tsx:12:1');
    expect(result).toContain('@c1 [?] Context.Provider');
    expect(result).toContain('in:App > SearchPage > FiltersPanel');
    expect(result).toContain('@c2 [?] Context.Provider');
    expect(result).toContain('in:App > SearchPage > ResultsPanel');
  });

  it('should not group rows with the same display name from different sources', () => {
    const reports: ComponentRenderReport[] = [
      {
        id: 1,
        displayName: 'Context.Provider',
        label: '@c1',
        type: 'other',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 5,
        totalDuration: 25,
        avgDuration: 5,
        maxDuration: 10,
        causes: ['parent-rendered'],
      },
      {
        id: 2,
        displayName: 'Context.Provider',
        label: '@c2',
        type: 'other',
        source: { fileName: '/src/context/ThemeContext.tsx', lineNumber: 9, columnNumber: 1 },
        sourceKey: '/src/context/ThemeContext.tsx:9:1',
        renderCount: 5,
        totalDuration: 20,
        avgDuration: 4,
        maxDuration: 8,
        causes: ['parent-rendered'],
      },
    ];

    const result = formatSlowest(reports);
    expect(result).not.toContain('2 instances');
    expect(result).toContain('@c1 [?] Context.Provider');
    expect(result).toContain('@c2 [?] Context.Provider');
  });

  it('should not group rows with missing source metadata', () => {
    const reports: ComponentRenderReport[] = [
      {
        id: 1,
        displayName: 'Context.Provider',
        label: '@c1',
        type: 'other',
        renderCount: 5,
        totalDuration: 25,
        avgDuration: 5,
        maxDuration: 10,
        causes: ['parent-rendered'],
      },
      {
        id: 2,
        displayName: 'Context.Provider',
        label: '@c2',
        type: 'other',
        renderCount: 5,
        totalDuration: 20,
        avgDuration: 4,
        maxDuration: 8,
        causes: ['parent-rendered'],
      },
    ];

    const result = formatSlowest(reports);
    expect(result).not.toContain('instances');
  });

  it('should respect visible limits after grouping', () => {
    const reports: ComponentRenderReport[] = [
      {
        id: 1,
        displayName: 'Context.Provider',
        label: '@c1',
        type: 'other',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 5,
        totalDuration: 25,
        avgDuration: 5,
        maxDuration: 10,
        causes: ['parent-rendered'],
      },
      {
        id: 2,
        displayName: 'Context.Provider',
        label: '@c2',
        type: 'other',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 4,
        totalDuration: 16,
        avgDuration: 4,
        maxDuration: 8,
        causes: ['parent-rendered'],
      },
      {
        id: 3,
        displayName: 'SearchResults',
        label: '@c3',
        type: 'function',
        renderCount: 3,
        totalDuration: 9,
        avgDuration: 3,
        maxDuration: 4,
        causes: ['props-changed'],
      },
      {
        id: 4,
        displayName: 'Footer',
        label: '@c4',
        type: 'function',
        renderCount: 2,
        totalDuration: 4,
        avgDuration: 2,
        maxDuration: 3,
        causes: ['parent-rendered'],
      },
    ];

    const result = formatSlowest(reports, 2);
    expect(result).toContain('Context.Provider  2 instances');
    expect(result).toContain('@c3 [fn] SearchResults');
    expect(result).not.toContain('@c4 [fn] Footer');
  });
});

describe('formatRerenders', () => {
  it('should format rerender data with labels and changed keys', () => {
    const reports: ComponentRenderReport[] = [
      { id: 1, displayName: 'Chatty', label: '@c1', type: 'function', renderCount: 50, totalDuration: 100, avgDuration: 2, maxDuration: 5, causes: ['parent-rendered', 'props-changed'], changedKeys: { props: ['value'], state: [], hooks: [] } },
    ];

    const result = formatRerenders(reports);
    expect(result).toContain('50 renders');
    expect(result).toContain('@c1 [fn] Chatty');
    expect(result).toContain('causes:parent-rendered, props-changed');
    expect(result).toContain('changed: props: value');
  });

  it('should omit changed line when keys are empty', () => {
    const reports: ComponentRenderReport[] = [
      { id: 1, displayName: 'Chatty', label: '@c1', type: 'function', renderCount: 50, totalDuration: 100, avgDuration: 2, maxDuration: 5, causes: ['parent-rendered'], changedKeys: { props: [], state: [], hooks: [] } },
    ];

    const result = formatRerenders(reports);
    expect(result).not.toContain('changed:');
  });

  it('should group repeated rerender rows by source identity and keep mixed ordering', () => {
    const reports: ComponentRenderReport[] = [
      {
        id: 1,
        displayName: 'Context.Provider',
        label: '@c1',
        type: 'other',
        path: 'App > FiltersPanel',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 20,
        totalDuration: 40,
        avgDuration: 2,
        maxDuration: 4,
        causes: ['parent-rendered'],
      },
      {
        id: 9,
        displayName: 'SearchResults',
        label: '@c9',
        type: 'function',
        path: 'App > SearchPage',
        renderCount: 15,
        totalDuration: 60,
        avgDuration: 4,
        maxDuration: 8,
        causes: ['props-changed'],
      },
      {
        id: 2,
        displayName: 'Context.Provider',
        label: '@c2',
        type: 'other',
        path: 'App > ResultsPanel',
        source: { fileName: '/src/context/SearchContext.tsx', lineNumber: 12, columnNumber: 1 },
        sourceKey: '/src/context/SearchContext.tsx:12:1',
        renderCount: 12,
        totalDuration: 20,
        avgDuration: 1.7,
        maxDuration: 3,
        causes: ['parent-rendered'],
      },
    ];

    const result = formatRerenders(reports);
    expect(result).toContain('Context.Provider  2 instances  src: SearchContext.tsx:12:1');
    expect(result).toContain('@c9 [fn] SearchResults  15 renders');
    expect(result.indexOf('Context.Provider  2 instances')).toBeLessThan(result.indexOf('@c9 [fn] SearchResults'));
  });
});

describe('formatTimeline', () => {
  it('should format timeline entries showing all commits', () => {
    const result: TimelineResult = {
      entries: [
        { index: 0, timestamp: 1000, duration: 12.5, componentCount: 5 },
        { index: 1, timestamp: 2000, duration: 8.3, componentCount: 3 },
      ],
      total: 2,
      offset: 0,
    };

    const output = formatTimeline(result);
    expect(output).toContain('2 commits');
    expect(output).toContain('#0');
    expect(output).toContain('12.5ms');
    expect(output).toContain('#1');
    expect(output).toContain('8.3ms');
  });

  it('should show pagination info when limited', () => {
    const result: TimelineResult = {
      entries: [
        { index: 0, timestamp: 1000, duration: 12.5, componentCount: 5 },
        { index: 1, timestamp: 2000, duration: 8.3, componentCount: 3 },
      ],
      total: 50,
      offset: 0,
    };

    const output = formatTimeline(result);
    expect(output).toContain('showing 1–2 of 50');
  });

  it('should show correct range with offset', () => {
    const result: TimelineResult = {
      entries: [
        { index: 20, timestamp: 1000, duration: 5.0, componentCount: 2 },
      ],
      total: 50,
      offset: 20,
    };

    const output = formatTimeline(result);
    expect(output).toContain('showing 21–21 of 50');
  });

  it('should return no data message when empty', () => {
    const result: TimelineResult = { entries: [], total: 0, offset: 0 };
    expect(formatTimeline(result)).toBe('No profiling data');
  });

  it('should handle offset past end gracefully', () => {
    const result: TimelineResult = { entries: [], total: 50, offset: 50 };
    const output = formatTimeline(result);
    expect(output).toContain('0 of 50');
    expect(output).not.toMatch(/showing \d+–\d+/);
  });
});

describe('formatCommitDetail', () => {
  it('should format commit detail with labels, types, and changed keys', () => {
    const detail: CommitDetail = {
      index: 0,
      timestamp: 1000,
      duration: 15.5,
      components: [
        { id: 1, displayName: 'App', label: '@c1', type: 'function', actualDuration: 15.5, selfDuration: 5.2, causes: ['state-changed'], changedKeys: { props: [], state: ['count'], hooks: [] } },
        { id: 2, displayName: 'Header', label: '@c2', type: 'memo', actualDuration: 10.3, selfDuration: 10.3, causes: ['props-changed', 'hooks-changed'], changedKeys: { props: ['onClick', 'className'], state: [], hooks: [0] } },
      ],
      totalComponents: 2,
    };

    const result = formatCommitDetail(detail);
    expect(result).toContain('Commit #0');
    expect(result).toContain('15.5ms');
    expect(result).toContain('2 components');
    expect(result).toContain('@c1 [fn] App');
    expect(result).toContain('self:5.2ms');
    expect(result).toContain('total:15.5ms');
    expect(result).toContain('causes:state-changed');
    expect(result).toContain('changed: state: count');
    expect(result).toContain('@c2 [memo] Header');
    expect(result).toContain('causes:props-changed, hooks-changed');
    expect(result).toContain('changed: props: onClick, className  hooks: #0');
  });

  it('should show hidden count', () => {
    const detail: CommitDetail = {
      index: 1,
      timestamp: 2000,
      duration: 10,
      components: [
        { id: 1, displayName: 'App', label: '@c1', type: 'function', actualDuration: 10, selfDuration: 10, causes: [], changedKeys: { props: [], state: [], hooks: [] } },
      ],
      totalComponents: 5,
    };

    const result = formatCommitDetail(detail);
    expect(result).toContain('... 4 more');
  });

  it('should omit changed keys when empty', () => {
    const detail: CommitDetail = {
      index: 0,
      timestamp: 1000,
      duration: 5,
      components: [
        { id: 1, displayName: 'App', label: '@c1', type: 'function', actualDuration: 5, selfDuration: 5, causes: ['first-mount'], changedKeys: { props: [], state: [], hooks: [] } },
      ],
      totalComponents: 1,
    };

    const result = formatCommitDetail(detail);
    expect(result).toContain('App');
    expect(result).not.toContain('changed:');
  });
});

describe('formatErrors', () => {
  it('should format empty results', () => {
    expect(formatErrors([])).toContain('No components with errors or warnings');
  });

  it('should format components with errors and warnings', () => {
    const nodes: TreeNode[] = [
      { id: 2, label: '@c2', displayName: 'Form', type: 'function', key: null, parentId: 1, children: [], depth: 1, errors: 3, warnings: 0 },
      { id: 3, label: '@c3', displayName: 'Input', type: 'function', key: null, parentId: 2, children: [], depth: 2, warnings: 2 },
    ];

    const result = formatErrors(nodes);
    expect(result).toContain('@c2 [fn] Form');
    expect(result).toContain('✗3');
    expect(result).toContain('@c3 [fn] Input');
    expect(result).toContain('⚠2');
  });
});

describe('error annotations in tree', () => {
  it('should annotate tree nodes with errors and warnings', () => {
    const nodes: TreeNode[] = [
      { id: 1, label: '@c1', displayName: 'App', type: 'function', key: null, parentId: null, children: [2], depth: 0 },
      { id: 2, label: '@c2', displayName: 'Form', type: 'function', key: null, parentId: 1, children: [], depth: 1, errors: 1, warnings: 2 },
    ];

    const result = formatTree(nodes);
    expect(result).toContain('@c2 [fn] Form ⚠2 ✗1');
    // App should not have annotations
    expect(result).toContain('@c1 [fn] App\n');
  });
});

describe('error annotations in component', () => {
  it('should show error/warning annotations when non-zero', () => {
    const element: InspectedElement & { errors?: number; warnings?: number } = {
      id: 5,
      displayName: 'Form',
      type: 'function',
      key: null,
      props: {},
      state: null,
      hooks: null,
      renderedAt: null,
      errors: 2,
      warnings: 1,
    };

    const result = formatComponent(element, '@c5');
    expect(result).toContain('@c5 [fn] Form ⚠1 ✗2');
  });

  it('should not show annotations when counts are zero', () => {
    const element: InspectedElement = {
      id: 5,
      displayName: 'Form',
      type: 'function',
      key: null,
      props: {},
      state: null,
      hooks: null,
      renderedAt: null,
    };

    const result = formatComponent(element, '@c5');
    expect(result).toBe('@c5 [fn] Form');
  });
});

describe('formatChangedKeys', () => {
  it('should format all key categories', () => {
    const keys: ChangedKeys = { props: ['onClick', 'className'], state: ['count'], hooks: [0, 3] };
    expect(formatChangedKeys(keys)).toBe('props: onClick, className  state: count  hooks: #0, #3');
  });

  it('should return empty string when no keys', () => {
    const keys: ChangedKeys = { props: [], state: [], hooks: [] };
    expect(formatChangedKeys(keys)).toBe('');
  });

  it('should omit empty categories', () => {
    const keys: ChangedKeys = { props: ['theme'], state: [], hooks: [] };
    expect(formatChangedKeys(keys)).toBe('props: theme');
  });
});
