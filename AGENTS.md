# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` imports this file.

## Build & Test Commands

```sh
bun install                # Install dependencies
bun run build              # Build (tsup, outputs to packages/agent-react-devtools/dist/)
bun run test               # Run all unit tests (vitest)
bun run typecheck          # Type check (tsc --noEmit)
bun run lint               # Same as typecheck — no formatter/linter configured
```

Run a single test file or test by name:
```sh
cd packages/agent-react-devtools && npx vitest run src/__tests__/component-tree.test.ts
cd packages/agent-react-devtools && npx vitest run -t "test name pattern"
```

## Project Structure

Bun monorepo with workspaces: `packages/*` and `examples/*`.

- `packages/agent-react-devtools/` — The only published package. Three build entry points via tsup:
  1. **CLI + Daemon** (`src/cli.ts`, `src/daemon.ts`) — Node 22, ESM with shebang
  2. **Connect script** (`src/connect.ts`) — Browser ESM, imported as `agent-react-devtools/connect`
  3. **Vite plugin** (`src/vite-plugin.ts`) — Node 18, imported as `agent-react-devtools/vite`
- `examples/vite-app/` and `examples/expo-app/` — Example apps (ignored by changesets)
- `vendor/react/` — Git submodule (React Compiler), not part of the build

## Architecture

```
CLI (cli.ts) ──→ IPC Client (daemon-client.ts) ──→ Unix Socket ──→ Daemon (daemon.ts)
                                                                          │
                                                           ┌──────────────┤
                                                           ▼              ▼
                                                    ComponentTree    Profiler
                                                    (component-     (profiler.ts)
                                                     tree.ts)
                                                           ▲
                                                           │
                                              DevToolsBridge (devtools-bridge.ts)
                                                    WebSocket ↔ React App
```

- **Daemon** (`daemon.ts`): Long-lived background process. Hosts an IPC server on a Unix socket (`~/.agent-react-devtools/daemon.sock`) and coordinates the bridge, tree, and profiler.
- **DaemonClient** (`daemon-client.ts`): IPC client used by CLI. Auto-spawns the daemon as a detached process if not running.
- **DevToolsBridge** (`devtools-bridge.ts`): WebSocket server implementing the React DevTools "Wall" protocol. Receives operations arrays from connected React apps.
- **ComponentTree** (`component-tree.ts`): Parses React DevTools v2 binary operations arrays into an in-memory tree of `ComponentNode` objects.
- **Profiler** (`profiler.ts`): Accumulates commit data from profiling sessions, computes render times and change causes.
- **Formatters** (`formatters.ts`): Token-efficient text output for LLM consumption.
- **Init** (`init.ts`): Framework detection (Vite/Next.js/CRA/RN) and auto-configuration for the `init` CLI command.

IPC messages are newline-delimited JSON. WebSocket messages use `{event, payload}` shape.

## React DevTools Protocol

Operations array format: `[rendererID, rootFiberID, stringTableSize, ...stringTable, ...ops]`

String table entries: `[length, ...charCodes]`. String ID 0 = null.

Operation types: ADD (1), REMOVE (2), REORDER (3), UPDATE_BASE_DURATION (4), UPDATE_ERRORS_OR_WARNINGS (5), REMOVE_ROOT (6), SET_SUBTREE_MODE (7).

Element types: CLASS=1, FUNCTION=5, FORWARD_REF=6, HOST=7, MEMO=8, PROFILER=10, ROOT=11, SUSPENSE=12.

## Vite Integration

`@vitejs/plugin-react` injects a `__REACT_DEVTOOLS_GLOBAL_HOOK__` stub that breaks react-devtools-core. The connect script (`connect.ts`) deletes this stub before initializing. Browser extensions may define the property as non-configurable, so deletion must be wrapped in try/catch.

## Release Process

Uses changesets for versioning. CI publishes to npm via OIDC (no token). Canary snapshots are published from unpublished changesets.

## Testing

Vitest with `globals: true` — `describe`, `it`, `expect` are available without imports. Test files live in `src/__tests__/`.

## Skills

A skill is a set of local instructions stored in a `SKILL.md` file.

### Available skills

- react-devtools: React DevTools CLI for AI agents. Use when debugging a React or React Native app at runtime, inspecting component props/state/hooks, diagnosing re-renders, or profiling performance. (file: `packages/agent-react-devtools/skills/react-devtools/SKILL.md`)

### How to use skills

- Trigger rule: Use `react-devtools` when the task is React runtime debugging or performance analysis.
- Invocation: Read `packages/agent-react-devtools/skills/react-devtools/SKILL.md` and follow its core workflow and command guidance.
