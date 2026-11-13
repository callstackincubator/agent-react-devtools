import type {
  StatusInfo,
  InspectedElement,
  ComponentRenderReport,
  ChangedKeys,
} from './types.js';
import type { TreeNode } from './component-tree.js';
import type { ProfileSummary, TimelineResult, CommitDetail } from './profiler.js';
import type { ProfileDiffResult, DiffEntry } from './profile-diff.js';
import { formatSourceLocation } from './source-metadata.js';

// ── Abbreviations for component types ──
const TYPE_ABBREV: Record<string, string> = {
  function: 'fn',
  class: 'cls',
  host: 'host',
  memo: 'memo',
  forwardRef: 'fRef',
  profiler: 'prof',
  suspense: 'susp',
  context: 'ctx',
  other: '?',
};

function typeTag(type: string): string {
  return TYPE_ABBREV[type] || type;
}

/**
 * Format a consistent component reference: `@c1 [fn] Name` or `@c1 [fn] Name key=x`
 * When errors/warnings are non-zero, appends annotations like `⚠2 ✗1`.
 */
function formatRef(opts: { label?: string; type?: string; name: string; key?: string | null; errors?: number; warnings?: number }): string {
  const ref = opts.label || '?';
  const tag = typeTag(opts.type || 'other');
  let s = `${ref} [${tag}] ${opts.name}`;
  if (opts.key) s += ` key=${opts.key}`;
  const annotations = formatErrorAnnotations(opts.errors, opts.warnings);
  if (annotations) s += ` ${annotations}`;
  return s;
}

/**
 * Format error/warning count annotations (e.g., `⚠2 ✗1`).
 * Returns empty string if both counts are zero or undefined.
 */
function formatErrorAnnotations(errors?: number, warnings?: number): string {
  const parts: string[] = [];
  if (warnings && warnings > 0) parts.push(`⚠${warnings}`);
  if (errors && errors > 0) parts.push(`✗${errors}`);
  return parts.join(' ');
}

// ── Tree connector characters ──
const PIPE = '│  ';
const TEE = '├─ ';
const ELBOW = '└─ ';
const SPACE = '   ';

/** Default number of siblings to show before collapsing a run */
const COLLAPSE_THRESHOLD = 3;

export interface FormatTreeOptions {
  /** Total component count (before filtering), for the summary footer */
  totalCount?: number;
  /** Maximum output lines (hard cap) */
  maxLines?: number;
  /** Hint text for empty tree */
  hint?: string;
}

export function formatTree(nodes: TreeNode[], hintOrOpts?: string | FormatTreeOptions): string {
  const opts: FormatTreeOptions =
    typeof hintOrOpts === 'string' ? { hint: hintOrOpts } : hintOrOpts || {};
  const { hint, totalCount, maxLines } = opts;

  if (nodes.length === 0) {
    return hint ? `No components (${hint})` : 'No components (is a React app connected?)';
  }

  // Build tree structure and id lookup from the flat list
  const childrenMap = new Map<number | null, TreeNode[]>();
  const nodeMap = new Map<number, TreeNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    const parentId = node.parentId;
    let siblings = childrenMap.get(parentId);
    if (!siblings) {
      siblings = [];
      childrenMap.set(parentId, siblings);
    }
    siblings.push(node);
  }

  const lines: string[] = [];
  let truncated = false;
  // Reserve lines for summary footer only; truncation replaces the last tree line
  const lineLimit = maxLines !== undefined
    ? maxLines - (totalCount !== undefined ? 1 : 0)
    : Infinity;

  function addLine(line: string): boolean {
    if (lines.length >= lineLimit) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  }

  function walk(nodeId: number, prefix: string, isLast: boolean, isRoot: boolean): boolean {
    const node = nodeMap.get(nodeId);
    if (!node) return true;

    const connector = isRoot ? '' : isLast ? ELBOW : TEE;
    const line = formatRef({ label: node.label, type: node.type, name: node.displayName, key: node.key, errors: node.errors, warnings: node.warnings });

    if (!addLine(`${prefix}${connector}${line}`)) return false;

    const children = childrenMap.get(node.id) || [];
    const childPrefix = isRoot ? '' : prefix + (isLast ? SPACE : PIPE);

    // Collapse repeated siblings with the same display name
    let i = 0;
    while (i < children.length) {
      // Find a run of siblings with the same displayName
      let runEnd = i + 1;
      while (runEnd < children.length && children[runEnd].displayName === children[i].displayName) {
        runEnd++;
      }
      const runLen = runEnd - i;

      if (runLen > COLLAPSE_THRESHOLD) {
        // Show first COLLAPSE_THRESHOLD items, then a summary line
        for (let j = 0; j < COLLAPSE_THRESHOLD; j++) {
          if (!walk(children[i + j].id, childPrefix, false, false)) return false;
        }
        // Summary line for the rest
        const remaining = runLen - COLLAPSE_THRESHOLD;
        const isLastGroup = runEnd === children.length;
        const summaryConnector = isLastGroup ? ELBOW : TEE;
        if (!addLine(`${childPrefix}${summaryConnector}... +${remaining} more ${children[i].displayName}`)) return false;
        i = runEnd;
      } else {
        // Render normally
        for (let j = i; j < runEnd; j++) {
          const isLastChild = j === children.length - 1;
          if (!walk(children[j].id, childPrefix, isLastChild, false)) return false;
        }
        i = runEnd;
      }
    }
    return true;
  }

  // Find root nodes
  const roots = childrenMap.get(null) || [];
  for (let i = 0; i < roots.length; i++) {
    if (!walk(roots[i].id, '', i === roots.length - 1, true)) break;
  }

  if (truncated) {
    if (totalCount !== undefined) {
      // Use the reserved footer slot for the truncation notice so no content line is lost.
      // Combine with total count so the summary info isn't dropped.
      lines.push(`... output truncated at ${maxLines} lines (${totalCount.toLocaleString()} total components)`);
    } else {
      // No footer reserved — replace last content line with truncation notice.
      if (lines.length > 0) {
        lines[lines.length - 1] = `... output truncated at ${maxLines} lines`;
      } else {
        lines.push(`... output truncated at ${maxLines} lines`);
      }
    }
  } else if (totalCount !== undefined) {
    // Summary footer (only when output was not truncated)
    const shown = nodes.length;
    const totalFormatted = totalCount.toLocaleString();
    if (shown < totalCount) {
      lines.push(`${shown} components shown (${totalFormatted} total)`);
    } else {
      lines.push(`${totalFormatted} components`);
    }
  }

  return lines.join('\n');
}

export function formatErrors(nodes: TreeNode[]): string {
  if (nodes.length === 0) return 'No components with errors or warnings';

  const lines: string[] = [];
  for (const n of nodes) {
    const ref = formatRef({ label: n.label, type: n.type, name: n.displayName, key: n.key, errors: n.errors, warnings: n.warnings });
    lines.push(ref);
  }
  return lines.join('\n');
}

export function formatComponent(element: InspectedElement & { errors?: number; warnings?: number }, label?: string): string {
  const lines: string[] = [];

  lines.push(formatRef({ label: label || `#${element.id}`, type: element.type, name: element.displayName, key: element.key, errors: element.errors, warnings: element.warnings }));

  // Props
  if (element.props && Object.keys(element.props).length > 0) {
    lines.push('props:');
    for (const [key, value] of Object.entries(element.props)) {
      lines.push(`  ${key}: ${formatCompactValue(value) ?? 'undefined'}`);
    }
  }

  // State
  if (element.state && Object.keys(element.state).length > 0) {
    lines.push('state:');
    for (const [key, value] of Object.entries(element.state)) {
      lines.push(`  ${key}: ${formatCompactValue(value) ?? 'undefined'}`);
    }
  }

  // Hooks
  if (element.hooks && element.hooks.length > 0) {
    lines.push('hooks:');
    for (const h of element.hooks) {
      const val = formatCompactValue(h.value);
      lines.push(val !== undefined ? `  ${h.name}: ${val}` : `  ${h.name}`);
      if (h.subHooks && h.subHooks.length > 0) {
        for (const sh of h.subHooks) {
          const sval = formatCompactValue(sh.value);
          lines.push(sval !== undefined ? `    ${sh.name}: ${sval}` : `    ${sh.name}`);
        }
      }
    }
  }

  return lines.join('\n');
}

export function formatSearchResults(results: TreeNode[]): string {
  if (results.length === 0) return 'No components found';

  return results
    .map((n) => {
      // Use numeric id as label when @c label isn't resolved (e.g., tree not traversed)
      const effectiveLabel = n.label === '@c?' ? `@c?(id:${n.id})` : n.label;
      return formatRef({ label: effectiveLabel, type: n.type, name: n.displayName, key: n.key, errors: n.errors, warnings: n.warnings });
    })
    .join('\n');
}

export function formatCount(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${typeTag(type)}:${count}`)
    .join(' ');
  return `${total} components (${parts})`;
}

export function formatStatus(status: StatusInfo): string {
  const lines: string[] = [];
  lines.push(`Daemon: running (port ${status.port})`);
  lines.push(
    `Apps: ${status.connectedApps} connected, ${status.componentCount} components`,
  );
  if (status.profilingActive) {
    lines.push('Profiling: active');
  }
  const upSec = Math.round(status.uptime / 1000);
  lines.push(`Uptime: ${upSec}s`);
  if (status.connection?.recentEvents?.length > 0) {
    const last = status.connection.recentEvents[status.connection.recentEvents.length - 1];
    const ago = formatAgo(Date.now() - last.timestamp);
    lines.push(`Last event: app ${last.type} ${ago}`);
  }
  return lines.join('\n');
}

export function formatAgo(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function formatProfileSummary(summary: ProfileSummary): string {
  const lines: string[] = [];
  const durSec = (summary.duration / 1000).toFixed(1);
  lines.push(
    `Profile "${summary.name}" (${durSec}s, ${summary.commitCount} commits)`,
  );

  if (summary.componentRenderCounts.length > 0) {
    lines.push('');
    lines.push('Top renders:');
    for (const c of summary.componentRenderCounts.slice(0, 10)) {
      const ref = formatRef({ label: c.label, type: c.type, name: c.displayName || `#${c.id}` });
      lines.push(`  ${ref}  ${c.count} renders`);
    }
  }

  return lines.join('\n');
}

export function formatProfileReport(report: ComponentRenderReport, label?: string): string {
  const lines: string[] = [];
  lines.push(formatRef({ label: label || report.label || `#${report.id}`, type: report.type, name: report.displayName }));
  if (report.path) {
    lines.push(`path: ${report.path}`);
  }
  const src = formatSourceLocation(report.source);
  if (src) {
    lines.push(`src: ${src}`);
  }
  lines.push(
    `renders:${report.renderCount}  avg:${report.avgDuration.toFixed(1)}ms  max:${report.maxDuration.toFixed(1)}ms  total:${report.totalDuration.toFixed(1)}ms`,
  );
  if (report.causes.length > 0) {
    lines.push(`causes: ${report.causes.join(', ')}`);
  }
  const keys = formatChangedKeys(report.changedKeys);
  if (keys) {
    lines.push(`changed: ${keys}`);
  }
  return lines.join('\n');
}

export function formatSlowest(reports: ComponentRenderReport[], visibleLimit?: number): string {
  if (reports.length === 0) return 'No profiling data';

  const lines: string[] = ['Slowest (by avg render time):'];
  for (const group of groupReportsBySource(reports, visibleLimit)) {
    if (group.type === 'single') {
      lines.push(formatSlowReportLine(group.report));
      continue;
    }

    const src = formatSourceLocation(group.source);
    const top = group.reports[0];
    let header = `  ${group.displayName}  ${group.reports.length} instances`;
    if (src) header += `  src: ${src}`;
    header += `  top avg:${top.avgDuration.toFixed(1)}ms`;
    lines.push(header);

    for (const report of group.reports) {
      lines.push(formatSlowReportLine(report, true));
    }
  }
  return lines.join('\n');
}

export function formatRerenders(reports: ComponentRenderReport[], visibleLimit?: number): string {
  if (reports.length === 0) return 'No profiling data';

  const lines: string[] = ['Most re-renders:'];
  for (const group of groupReportsBySource(reports, visibleLimit)) {
    if (group.type === 'single') {
      lines.push(formatRerenderReportLine(group.report));
      continue;
    }

    const src = formatSourceLocation(group.source);
    const top = group.reports[0];
    let header = `  ${group.displayName}  ${group.reports.length} instances`;
    if (src) header += `  src: ${src}`;
    header += `  top renders:${top.renderCount}`;
    lines.push(header);

    for (const report of group.reports) {
      lines.push(formatRerenderReportLine(report, true));
    }
  }
  return lines.join('\n');
}

export function formatTimeline(result: TimelineResult): string {
  if (result.total === 0) return 'No profiling data';

  const { entries, total, offset } = result;

  if (entries.length === 0) {
    return `Commit timeline (showing 0 of ${total}): offset past end`;
  }

  let header: string;
  if (entries.length === total) {
    header = `Commit timeline (${total} commits):`;
  } else {
    const from = offset + 1;
    const to = offset + entries.length;
    header = `Commit timeline (showing ${from}–${to} of ${total}):`;
  }

  const lines: string[] = [header];
  for (const e of entries) {
    lines.push(
      `  #${e.index}  ${e.duration.toFixed(1)}ms  ${e.componentCount} components`,
    );
  }
  return lines.join('\n');
}

export function formatCommitDetail(detail: CommitDetail): string {
  const lines: string[] = [];
  lines.push(`Commit #${detail.index}  ${detail.duration.toFixed(1)}ms  ${detail.totalComponents} components`);
  lines.push('');
  for (const c of detail.components) {
    const ref = formatRef({ label: c.label, type: c.type, name: c.displayName });
    const causes = c.causes.length > 0 ? c.causes.join(', ') : '?';
    let line = `  ${ref}  self:${c.selfDuration.toFixed(1)}ms  total:${c.actualDuration.toFixed(1)}ms  causes:${causes}`;
    const keys = formatChangedKeys(c.changedKeys);
    if (keys) line += `  changed: ${keys}`;
    lines.push(line);
  }
  const hidden = detail.totalComponents - detail.components.length;
  if (hidden > 0) {
    lines.push(`  ... ${hidden} more (use --limit to show more)`);
  }
  return lines.join('\n');
}

// ── Changed-keys helper ──

export function formatChangedKeys(keys: ChangedKeys | undefined): string {
  if (!keys) return '';
  const parts: string[] = [];
  if (keys.props.length > 0) parts.push(`props: ${keys.props.join(', ')}`);
  if (keys.state.length > 0) parts.push(`state: ${keys.state.join(', ')}`);
  if (keys.hooks.length > 0) parts.push(`hooks: ${keys.hooks.map((h) => `#${h}`).join(', ')}`);
  return parts.join('  ');
}

// ── Helpers ──

type ReportGroup =
  | { type: 'single'; report: ComponentRenderReport }
  | {
      type: 'group';
      displayName: string;
      source: NonNullable<ComponentRenderReport['source']>;
      reports: ComponentRenderReport[];
    };

function formatSlowReportLine(report: ComponentRenderReport, nested = false): string {
  const ref = formatRef({ label: report.label, type: report.type, name: report.displayName });
  const causes = report.causes.length > 0 ? report.causes.join(', ') : '?';
  const prefix = nested ? '    ' : '  ';
  let line = `${prefix}${ref}  avg:${report.avgDuration.toFixed(1)}ms  max:${report.maxDuration.toFixed(1)}ms  renders:${report.renderCount}  causes:${causes}`;
  if (report.path) line += `  in:${report.path}`;
  const keys = formatChangedKeys(report.changedKeys);
  if (keys) line += `  changed: ${keys}`;
  return line;
}

function formatRerenderReportLine(report: ComponentRenderReport, nested = false): string {
  const ref = formatRef({ label: report.label, type: report.type, name: report.displayName });
  const causes = report.causes.length > 0 ? report.causes.join(', ') : '?';
  const prefix = nested ? '    ' : '  ';
  let line = `${prefix}${ref}  ${report.renderCount} renders  causes:${causes}`;
  if (report.path) line += `  in:${report.path}`;
  const keys = formatChangedKeys(report.changedKeys);
  if (keys) line += `  changed: ${keys}`;
  return line;
}

function groupReportsBySource(reports: ComponentRenderReport[], visibleLimit?: number): ReportGroup[] {
  const buckets = new Map<string, ComponentRenderReport[]>();
  const order: string[] = [];

  for (const report of reports) {
    if (!report.sourceKey) continue;
    const key = `${report.displayName}::${report.sourceKey}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(report);
  }

  const groupedKeys = new Set<string>();
  for (const key of order) {
    if ((buckets.get(key)?.length || 0) > 1) {
      groupedKeys.add(key);
    }
  }

  const groups: ReportGroup[] = [];
  let visibleCount = 0;
  for (const report of reports) {
    if (visibleLimit !== undefined && visibleCount >= visibleLimit) {
      break;
    }

    if (!report.sourceKey) {
      groups.push({ type: 'single', report });
      visibleCount++;
      continue;
    }

    const key = `${report.displayName}::${report.sourceKey}`;
    if (!groupedKeys.has(key)) {
      groups.push({ type: 'single', report });
      visibleCount++;
      continue;
    }

    if (groups.some((group) => group.type === 'group' && group.reports[0]?.sourceKey === report.sourceKey && group.displayName === report.displayName)) {
      continue;
    }

    const bucket = buckets.get(key) || [report];
    const source = bucket[0].source;
    if (!source) {
      groups.push({ type: 'single', report });
      continue;
    }

    groups.push({
      type: 'group',
      displayName: report.displayName,
      source,
      reports: bucket,
    });
    visibleCount++;
  }

  return groups;
}

function formatCompactValue(val: unknown): string | undefined {
  if (val === undefined) return undefined;
  if (val === null) return 'null';
  if (typeof val === 'function') return 'ƒ';
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    const s = JSON.stringify(val, replacer, 0);
    if (s && s.length > 60) return s.slice(0, 57) + '...';
    return s || String(val);
  } catch {
    return String(val);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'function') return 'ƒ';
  return value;
}

// ── Profile Diff ──

function fmtMs(ms: number): string {
  return ms.toFixed(1) + 'ms';
}

function fmtPct(pct: number | null): string {
  if (pct === null) return '';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

function fmtDiffLine(e: DiffEntry): string {
  const before = e.before ? fmtMs(e.before.avgDuration) : '-';
  const after = e.after ? fmtMs(e.after.avgDuration) : '-';
  const pct = fmtPct(e.avgDurationDeltaPct);
  const rendersBefore = e.before ? String(e.before.renderCount) : '-';
  const rendersAfter = e.after ? String(e.after.renderCount) : '-';
  return `  ${e.displayName.padEnd(30)} avg: ${before.padStart(8)} -> ${after.padStart(8)}  ${pct.padStart(6)}  renders: ${rendersBefore} -> ${rendersAfter}`;
}

export function formatProfileDiff(diff: ProfileDiffResult, limit?: number): string {
  const lines: string[] = [];
  const s = diff.summary;

  lines.push(`Before: ${s.totalCommitsBefore} commits, ${fmtMs(s.totalDurationBefore)} total`);
  lines.push(`After:  ${s.totalCommitsAfter} commits, ${fmtMs(s.totalDurationAfter)} total`);

  const durDelta = s.totalDurationAfter - s.totalDurationBefore;
  const durPct = s.totalDurationBefore > 0 ? (durDelta / s.totalDurationBefore) * 100 : 0;
  lines.push(`Delta:  ${fmtMs(durDelta)} (${fmtPct(durPct)})`);

  if (diff.regressed.length > 0) {
    lines.push('');
    lines.push(`Regressed (${diff.regressed.length}):`);
    for (const e of diff.regressed.slice(0, limit)) {
      lines.push(fmtDiffLine(e));
    }
    const hidden = diff.regressed.length - (limit ?? diff.regressed.length);
    if (hidden > 0) lines.push(`  ... ${hidden} more`);
  }

  if (diff.improved.length > 0) {
    lines.push('');
    lines.push(`Improved (${diff.improved.length}):`);
    for (const e of diff.improved.slice(0, limit)) {
      lines.push(fmtDiffLine(e));
    }
    const hidden = diff.improved.length - (limit ?? diff.improved.length);
    if (hidden > 0) lines.push(`  ... ${hidden} more`);
  }

  if (diff.added.length > 0) {
    lines.push('');
    lines.push(`New (${diff.added.length}):`);
    for (const e of diff.added.slice(0, limit)) {
      lines.push(fmtDiffLine(e));
    }
    const hidden = diff.added.length - (limit ?? diff.added.length);
    if (hidden > 0) lines.push(`  ... ${hidden} more`);
  }

  if (diff.removed.length > 0) {
    lines.push('');
    lines.push(`Removed (${diff.removed.length}):`);
    for (const e of diff.removed.slice(0, limit)) {
      lines.push(fmtDiffLine(e));
    }
    const hidden = diff.removed.length - (limit ?? diff.removed.length);
    if (hidden > 0) lines.push(`  ... ${hidden} more`);
  }

  if (diff.regressed.length === 0 && diff.improved.length === 0 && diff.added.length === 0 && diff.removed.length === 0) {
    lines.push('');
    lines.push(`No significant changes (all within ${s.thresholdPct}% threshold)`);
  }

  return lines.join('\n');
}
