# agent-react-devtools

## 0.6.0

### Minor Changes

- [#59](https://github.com/callstackincubator/agent-react-devtools/pull/59) [`d25f34b`](https://github.com/callstackincubator/agent-react-devtools/commit/d25f34b568467e0b1fcde39410410bb514829a69) Thanks [@thymikee](https://github.com/thymikee)! - Tree observation commands (`get tree`, `get component`, `find`, `count`,
  `errors`, `profile start`) now fail with a typed `no-app-attached` reason and a
  non-zero exit code when no React app is attached, instead of reporting an empty
  result that reads as a clean pass. When another React DevTools backend attaches
  to the same app (React Native DevTools opening, another agent) and re-flushes the
  tree under a fresh fiber-ID space, the daemon now replaces its frozen copy
  instead of counting every component twice.

## 0.5.0

### Minor Changes

- [#58](https://github.com/callstackincubator/agent-react-devtools/pull/58) [`d4b1e2c`](https://github.com/callstackincubator/agent-react-devtools/commit/d4b1e2c644d40a66d60f24d41b7c37da8f1bf227) Thanks [@V3RON](https://github.com/V3RON)! - Automatically configure standard React Native and Expo projects through a
  CommonJS Metro wrapper and a native bootstrap entry import. Unsupported Metro
  formats and ambiguous projects retain the documented manual setup path.

## 0.4.0

### Minor Changes

- 0c307e2: Track and expose component error/warning counts

  Components now track error and warning counts from the React DevTools protocol (`UPDATE_ERRORS_OR_WARNINGS` operations).

  - New `errors` command lists components with non-zero error or warning counts
  - `get component` output includes error/warning counts when non-zero
  - Tree, search, and component output annotates affected components (e.g., `@c5 [fn] Form ⚠2 ✗1`)

- 65c391f: Add `profile diff <before.json> <after.json>` command

  - Compares two profiling exports side by side
  - Shows regressed, improved, new, and removed components
  - Aggregates by display name, computes avg/max duration deltas
  - Configurable threshold filters noise from insignificant changes (default 5%, adjust with `--threshold`)
  - No daemon required - works purely on exported JSON files

- 5c5ace6: Add `profile export <file>` command

  - Exports profiling session as a JSON file compatible with the React DevTools Profiler
  - Import the file in the browser extension's Profiler tab to visualize flame graphs, ranked charts, and commit timelines
  - Includes commit data, fiber durations, change descriptions, effect durations, and component snapshots

- b0e64b8: Pagination and sorting for `profile timeline`

  Large profiling sessions no longer flood agent context with hundreds of commits:

  - **Default limit of 20**: `profile timeline` returns at most 20 entries unless `--limit N` is specified.
  - **`--offset N` flag**: Skip the first N commits for pagination.
  - **`--sort duration`**: Sort commits by render duration (slowest first) instead of chronological order.
  - **Paginated header**: Output shows `Commit timeline (showing 1–20 of 87):` when paginated, or `Commit timeline (87 commits):` when all results fit on one page.

- a1bed65: Smart tree truncation and subtree extraction for large component trees

  Large React apps (500-2000+ components) now produce much smaller `get tree` output:

  - **Host filtering by default**: `<div>`, `<span>`, and other host components are hidden (use `--all` to show them). Host components with keys or custom element names are always shown.
  - **Sibling collapsing**: When a parent has many children with the same display name (e.g. list items), only the first 3 are shown with a `... +N more ComponentName` summary.
  - **Summary footer**: Output ends with `N components shown (M total)` so the agent knows how much was filtered.
  - **`--max-lines N` flag**: Hard cap on output lines to stay within context budgets.
  - **Subtree extraction**: `get tree @c5` shows only the subtree rooted at a specific component. Labels are re-assigned starting from `@c1` within the subtree. Combine with `--depth N` to limit depth within the subtree.

- c7127db: Add `uninit` command to reverse framework configuration

  `agent-react-devtools uninit` removes the changes made by `init` — restoring your config files to their original state.

  - Supports all frameworks: Vite, Next.js (Pages Router and App Router), CRA
  - `--dry-run` flag previews what would be removed without writing any files
  - Safe to run on projects not configured by `init` (no-op)

### Patch Changes

- 68bd0fc: Auto-restart daemon when CLI detects the binary has been rebuilt since the daemon started. Previously, rebuilding the package required manually stopping and restarting the daemon for changes to take effect.
- 90d1344: Fix component inspection crash and unresolvable find results

  - Fixed a crash in hook parsing that caused `get component` to silently time out on all components in affected apps
  - Components outside the labeled tree range now show a usable ID (e.g. `@c?(id:667)`) in `find` results

## 0.3.0

### Minor Changes

- e9c8a60: Show connection health in `status` and `get tree`

  - Show last connection event in `status` (e.g. "app reconnected 3s ago")
  - Show contextual hint when `get tree` returns empty after a disconnect

- 20ce273: Standardize component reference format across all CLI output

  All formatters now produce consistent `@cN [type] Name` references. Previously, tree and search commands used `@c1 [fn] "Name"` while profiling commands omitted labels, type tags, or both.

  **Breaking changes to output format:**

  - Component names are no longer quoted: `@c1 [fn] App` instead of `@c1 [fn] "App"`
  - Keys use `key=value` instead of `key="value"`
  - Profiling commands (`profile slow`, `profile rerenders`, `profile stop`, `profile commit`) now include `@cN` labels and `[type]` tags
  - `profile slow` and `profile rerenders` show all render causes instead of only the first
  - `profile report` now includes a `[type]` tag in the header
  - Column-aligned padding removed from profiling output in favor of consistent `formatRef` formatting

- 05090ca: Surface specific changed prop/state/hook keys in profiling output

  Profiling reports and commit details now show _which_ props, state keys, and hooks changed, not just _that_ they changed.

  - `profile report` and `profile slow` append `changed: props: onClick, className  state: count` lines
  - `profile rerenders` and `profile commit` include the same detail per component
  - Keys are deduplicated across commits in aggregate reports
  - Empty keys produce no extra output (backward-compatible)

- e9c8a60: Add `wait` command

  - `wait --connected` — block until a React app connects
  - `wait --component <name>` — block until a named component appears in the tree
  - Both support `--timeout` (default 30s) and exit non-zero on timeout

### Patch Changes

- 303f9e4: Fixed Vite HMR (hot module replacement) breaking when the `reactDevtools()` plugin is added to `vite.config.ts`. The connect module now preserves the react-refresh runtime's inject wrapper when replacing the devtools hook, so both Fast Refresh and devtools inspection work correctly.

## 0.2.2

### Patch Changes

- 370ef23: fix: prevent race condition where React loads before devtools hook is installed

  The connect module's dynamic `import('react-devtools-core')` yielded control before `initialize()` could install the hook, allowing react-dom to load first and miss the connection. Added top-level `await` to block dependent modules until the hook is ready, and updated the Vite plugin to enable `top-level-await` in esbuild's dep optimizer.

## 0.2.1

### Patch Changes

- 0c2de5b: Add Claude Code skill and plugin marketplace metadata

## 0.2.0

### Minor Changes

- 0c88c11: Zero-config app integration — connect your React app in one line:

  - **`agent-react-devtools init`** — CLI command that auto-detects your framework (Vite, Next.js, CRA, React Native) and patches the right config files. Next.js App Router gets a `'use client'` wrapper so the connect code runs in the browser.
  - **`agent-react-devtools/connect`** — add `import 'agent-react-devtools/connect'` as the first line of your entry point to connect to the daemon. Skips SSR and production builds automatically, never blocks your app.
  - **`agent-react-devtools/vite`** — Vite plugin that injects the connect script automatically, no app code changes needed.

### Patch Changes

- 10ac53c: Add comprehensive README with usage examples and MIT LICENSE file

## 0.1.0

### Minor Changes

- d1e02f9: **Daemon, DevTools bridge, and component tree**

  **Daemon** — Persistent background process with IPC server (Unix socket) that manages connections and dispatches commands.

  **DevTools Bridge** — WebSocket server implementing the React DevTools "Wall" protocol. Connects to running React apps via `react-devtools-core`.

  **Component Tree** — Parse and inspect the full React component hierarchy:

  - View component tree with types, keys, and parent/child relationships
  - Inspect props, state, and hooks of any component
  - Search components by display name (fuzzy or exact match)
  - Count components by type

  **CLI** — Command-line interface with commands: `start`, `stop`, `status`, `tree`, `find`, `count`, `get component`.

  **Formatting** — Token-efficient output designed for LLM consumption.

- 626a21a: **Profiler**

  Start and stop profiling sessions to capture render performance data from connected React apps.

  - **Render reports** — Per-component render duration and count
  - **Slowest components** — Ranked by self render time
  - **Most re-rendered** — Ranked by render count
  - **Commit timeline** — Chronological view of React commits with durations
  - **Commit details** — Per-component breakdown for a specific commit, sorted by self time

  CLI commands: `profile start`, `profile stop`, `profile report`, `profile slow`, `profile rerenders`, `profile timeline`, `profile commit`.
