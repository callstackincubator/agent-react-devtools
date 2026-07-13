# agent-react-devtools

Give your AI agent eyes into your React app. Inspect component trees, read props and state, and profile rendering performance — all from the command line. Inspired by Vercel's [agent-browser](https://github.com/vercel-labs/agent-browser) and Callstack's [agent-device](https://github.com/callstackincubator/agent-device).

The project is in early development and considered experimental. Pull requests are welcome!

## Features

- Walk the full component tree with props, state, and hooks
- Search for components by display name
- Profile renders: find slow components, excessive re-renders, and commit timelines
- Persistent background daemon that survives across CLI calls
- Token-efficient output built for LLM consumption

## Install

```sh
npm install -g agent-react-devtools
```

Or run it directly:

```sh
npx agent-react-devtools start
```

## Quick Start

```sh
agent-react-devtools start
agent-react-devtools status
```

```
Daemon: running (port 8097)
Apps: 1 connected, 24 components
Uptime: 12s
Last event: app connected 3s ago
```

Browse the component tree:

```sh
agent-react-devtools get tree --depth 3
```

```
@c1 [fn] App
├─ @c2 [fn] Header
│  ├─ @c3 [fn] Nav
│  └─ @c4 [fn] SearchBar
├─ @c5 [fn] TodoList
│  ├─ @c6 [fn] TodoItem key=1
│  ├─ @c7 [fn] TodoItem key=2
│  ├─ @c8 [fn] TodoItem key=3
│  └─ ... +47 more TodoItem
└─ @c9 [fn] Footer
53 components shown (1,843 total)
```

Host components (`<div>`, `<span>`, etc.) are filtered by default to keep output compact. Use `--all` to include them. Host components with keys or custom element names (e.g. `<my-widget>`) are always shown.

View a subtree rooted at a specific component:

```sh
agent-react-devtools get tree @c5 --depth 2
```

```
@c1 [fn] TodoList
├─ @c2 [fn] TodoItem key=1
├─ @c3 [fn] TodoItem key=2
└─ @c4 [fn] TodoItem key=3
```

Inspect a component's props, state, and hooks:

```sh
agent-react-devtools get component @c6
```

```
@c6 [fn] TodoItem key=1
props:
  id: 1
  text: "Buy groceries"
  done: false
  onToggle: ƒ
hooks:
  State: false
  Callback: ƒ
```

Find components by name:

```sh
agent-react-devtools find TodoItem
```

```
@c6 [fn] TodoItem key=1
@c7 [fn] TodoItem key=2
@c8 [fn] TodoItem key=3
```

Profile rendering performance:

```sh
agent-react-devtools profile start
# ... interact with the app ...
agent-react-devtools profile stop
agent-react-devtools profile slow
```

```
Slowest (by avg render time):
  @c5 [fn] TodoList  avg:4.2ms  max:8.1ms  renders:6  causes:props-changed  changed: props: items, onDelete
  @c4 [fn] SearchBar  avg:2.1ms  max:3.4ms  renders:12  causes:hooks-changed  changed: hooks: #0
  @c2 [fn] Header  avg:0.8ms  max:1.2ms  renders:3  causes:parent-rendered
```

## Commands

### Daemon

```sh
agent-react-devtools start [--port 8097]   # Start daemon
agent-react-devtools stop                   # Stop daemon
agent-react-devtools status                 # Connection status
```

### Components

```sh
agent-react-devtools get tree [@c1 | id] [--depth N] [--all] [--max-lines N]  # Component hierarchy (subtree)
agent-react-devtools get component <@c1 | id>      # Props, state, hooks
agent-react-devtools find <name> [--exact]          # Search by display name
agent-react-devtools count                          # Component count by type
agent-react-devtools errors                         # Components with errors/warnings
```

Tree output flags:
- `--depth N` — limit tree depth
- `--all` — include host components (filtered by default)
- `--max-lines N` — hard cap on output lines

Components are labeled `@c1`, `@c2`, etc. You can use these labels or numeric IDs interchangeably.

Components with errors or warnings are annotated in tree and search output:

```
@c5 [fn] Form ⚠2 ✗1
```

Use the `errors` command to list only components with issues:

```sh
agent-react-devtools errors
```

```
@c5 [fn] Form ⚠2 ✗1
@c8 [fn] Input ✗3
```

### Wait

Block until a condition is met. Useful in scripts or agent workflows where the daemon starts before the app:

```sh
agent-react-devtools wait --connected [--timeout 30]          # Block until an app connects
agent-react-devtools wait --component App [--timeout 30]      # Block until a component appears
```

Exits with code 0 when the condition is met, or code 1 on timeout.

### Profiling

```sh
agent-react-devtools profile start [name]           # Begin a profiling session
agent-react-devtools profile stop                    # Stop and collect data
agent-react-devtools profile report <@c1 | id>      # Render report for a component
agent-react-devtools profile slow [--limit N]        # Slowest components by avg duration
agent-react-devtools profile rerenders [--limit N]   # Most re-rendered components
agent-react-devtools profile timeline [--limit N]    # Commit timeline
agent-react-devtools profile commit <N | #N> [--limit N]  # Single commit detail
agent-react-devtools profile export <file>               # Export as React DevTools Profiler JSON
agent-react-devtools profile diff <before.json> <after.json> [--limit N] [--threshold N]  # Compare two exports
```

## Connecting Your App

### Quick setup

For Vite, Next.js, and Create React App, run `init` in the project root to
patch the appropriate web entry or config:

```sh
npx agent-react-devtools init
```

React Native is detected too, but `init` only prints the manual React Native
setup shown below; it does not edit Metro or application files.

To undo these changes:

```sh
npx agent-react-devtools uninit
```

### Web one-line import

Add a single import as the first line of your entry point (e.g. `src/main.tsx`):

```ts
import "agent-react-devtools/connect";
```

This handles everything: deleting the Vite hook stub, initializing react-devtools-core, and connecting via WebSocket. Your app is never blocked — if the daemon isn't running, it times out after 2 seconds.

### Vite plugin

For Vite apps, use the plugin instead — no changes to your app code needed:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { reactDevtools } from "agent-react-devtools/vite";

export default defineConfig({
  plugins: [reactDevtools(), react()],
});
```

The plugin only runs in dev mode (`vite dev`), not in production builds.

Options:

```ts
reactDevtools({ port: 8097, host: "localhost" });
```

### React Native 0.87+

React Native 0.87 removed the legacy standalone React DevTools auto-connect
path. Projects must now add the agent bootstrap to Metro explicitly:

```sh
npm install --save-dev agent-react-devtools react-devtools-core@^6.1.5
```

Both of the following steps are required.

#### 1. Wrap the final Metro config

For a bare React Native app:

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withAgentReactDevTools } = require("agent-react-devtools/metro");

const projectConfig = {};
const config = mergeConfig(getDefaultConfig(__dirname), projectConfig);

module.exports = withAgentReactDevTools(config);
```

For Expo:

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withAgentReactDevTools } = require("agent-react-devtools/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentReactDevTools(config);
```

Apply `withAgentReactDevTools` outermost, after all other Metro configuration
and wrappers. It preserves the final config's existing serializer hooks and
adds the agent bootstrap after React Native's own pre-main initialization.

#### 2. Import the bootstrap from the entry graph

Add this import to a user-owned module that is always reachable from the app
entry—for example, bare React Native's `index.js` or Expo Router's
`app/_layout.tsx`:

```ts
import "agent-react-devtools/react-native";
```

The import makes the bootstrap part of Metro's dependency graph. The Metro
wrapper then executes that module before application modules; its textual
position among imports does not control the execution order.

#### Run and verify

The client and daemon use port 8097 by default:

```sh
# Terminal 1
agent-react-devtools start

# Terminal 2 — restart Metro after changing metro.config.js
npx react-native start
# Expo: npx expo start

# Terminal 3
agent-react-devtools status
agent-react-devtools wait --connected --timeout 30
agent-react-devtools get tree
```

For an Android device connected over USB, forward the DevTools port before
launching the app:

```sh
adb reverse tcp:8097 tcp:8097
```

This integration connects only from a native development runtime and only on
React Native 0.87 or newer. Native production builds exit without connecting;
browser and default/server imports resolve to no-op modules.

If `status` reports zero connected apps:

1. Confirm both the Metro wrapper and graph import are present.
2. Ensure `withAgentReactDevTools` wraps the final config, outside other Metro wrappers.
3. Stop and restart Metro; if its cache is stale, use `--reset-cache` (bare) or `npx expo start -c`.
4. Confirm the daemon is listening on 8097 and repeat `adb reverse` for Android devices.
5. Check that the app is a development build running React Native 0.87+.

## Using with agent-browser

When using `agent-browser` to drive the app (e.g. for profiling interactions), you **must use headed mode**. Headless Chromium does not properly execute the devtools connect script:

```sh
agent-browser --session devtools --headed open http://localhost:5173/
agent-react-devtools status  # Should show "Apps: 1 connected"
```

## Using with AI Coding Assistants

Add the skill to your AI coding assistant for richer context:

```sh
npx skills add callstackincubator/agent-react-devtools
```

This works with Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Goose, OpenCode, and Windsurf.

### Claude Code plugin

You can also install via the Claude Code plugin marketplace:

```
/plugin marketplace add callstackincubator/agent-react-devtools
/plugin install agent-react-devtools@piotrski
```

### Codex

Codex discovers project skills from `AGENTS.md`. This repo includes one at the root that registers:

- `packages/agent-react-devtools/skills/react-devtools/SKILL.md`

### Manual setup

If your assistant does not auto-load skills, add something like this to your project's `AGENTS.md`, `CLAUDE.md`, or equivalent agent instructions:

```markdown
## React Debugging

This project uses agent-react-devtools to inspect the running React app.

- `agent-react-devtools start` — start the daemon
- `agent-react-devtools status` — check if the app is connected
- `agent-react-devtools get tree` — see the component hierarchy
- `agent-react-devtools get tree @c5` — see subtree from a specific component
- `agent-react-devtools get component @c1` — inspect a specific component
- `agent-react-devtools find <Name>` — search for components
- `agent-react-devtools errors` — list components with errors or warnings
- `agent-react-devtools profile start` / `profile stop` / `profile slow` — diagnose render performance
```

## Development

```sh
bun install        # Install dependencies
bun run build      # Build
bun run test       # Run tests
bun run typecheck  # Type check
```

## License

MIT
