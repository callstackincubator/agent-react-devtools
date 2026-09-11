# Setup Guide

agent-react-devtools works with React web and React Native apps. The `init`
command auto-configures Vite, Next.js, Create React App, and standard React
Native/Expo projects with CommonJS Metro configs.

## Web Auto Setup (Recommended)

```bash
cd your-react-app
npx agent-react-devtools init
```

This detects a supported web framework and applies the minimal configuration
needed.

Use `--dry-run` to preview changes without modifying files:
```bash
npx agent-react-devtools init --dry-run
```

## Framework-Specific Details

### Vite

`init` adds the Vite plugin to your config:

```ts
// vite.config.ts
import { reactDevtools } from "agent-react-devtools/vite";

export default defineConfig({
  plugins: [reactDevtools(), react()],
});
```

The plugin only runs in dev mode (`vite dev`). It injects the connect script before your app code loads. Zero app code changes needed.

### Next.js (App Router)

`init` creates a client component that imports the connect script and adds it to your root layout:

```tsx
// app/devtools.tsx
'use client';
import 'agent-react-devtools/connect';
export default function DevTools() { return null; }
```

Then imports it in `app/layout.tsx`.

### Create React App

`init` prepends the import to `src/index.tsx`:

```ts
import 'agent-react-devtools/connect';
```

### React Native / Expo

The Metro wrapper and entry-graph import below are both mandatory. For a
standard project, `init` adds both automatically: it supports existing
`metro.config.js`/`.cjs` files, or creates the appropriate default config when
none exists, then patches `package.json` `main`, Expo Router's root layout,
bare `index.*`, or Expo `App.*`.

It safely falls back without editing files for ESM, TypeScript, JSON or
package-field Metro configurations, custom `--config` usage, or ambiguous
targets. In those cases, apply the two manual steps below.

```bash
npm install --save-dev agent-react-devtools
```

For bare React Native, wrap the final composed config:

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withAgentReactDevTools } = require('agent-react-devtools/metro');

const projectConfig = {};
const config = mergeConfig(getDefaultConfig(__dirname), projectConfig);

module.exports = withAgentReactDevTools(config);
```

For Expo, extend Expo's Metro config:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAgentReactDevTools } = require('agent-react-devtools/metro');

const config = getDefaultConfig(__dirname);

module.exports = withAgentReactDevTools(config);
```

`withAgentReactDevTools` must be the outermost wrapper around the final config
so existing serializer hooks are retained. Then import the bootstrap from a
module in the application entry graph, such as `index.js` or Expo Router's
root layout:

```ts
import 'agent-react-devtools/react-native';
```

The import puts the module into Metro's dependency graph; the wrapper executes
it after React Native initialization and before application modules. Restart
Metro after changing `metro.config.js`.

`uninit` removes only the ownership-marked import and Metro wrapper it added.
It deletes an auto-created config only if it is still unchanged.

The daemon and client use port 8097 by default:

```bash
agent-react-devtools start
adb reverse tcp:8097 tcp:8097 # Android device over USB
npx react-native start        # or: npx expo start
agent-react-devtools wait --connected --timeout 30
agent-react-devtools status
```

The client connects only from native development runtimes. Native production
builds exit without connecting; web and default/server imports resolve to
no-op modules.

## Manual Web Setup

If `init` doesn't cover your setup, add this as the first import in your entry point:

```ts
import 'agent-react-devtools/connect';
```

The connect script is:
- **SSR-safe** — no-ops on the server
- **Production-safe** — tree-shaken in production builds
- Connects via WebSocket with a 2-second timeout

## Verifying the Connection

```bash
agent-react-devtools status
```

Expected output when connected:
```
Daemon: running (port 8097)
Apps: 1 connected, 42 components
```

If `Apps: 0 connected`:
1. Check the app is running in dev mode
2. For React Native, verify both the outermost Metro wrapper and entry-graph import, then restart Metro
3. Check the console for WebSocket connection errors
4. Ensure no other DevTools instance is using port 8097
5. For an Android device, repeat `adb reverse tcp:8097 tcp:8097`
6. If using `agent-browser`, make sure you're using **headed mode** (`--headed`) — headless Chromium does not properly execute the devtools connect script

## Using with agent-browser

When automating the browser with `agent-browser`, you must use headed mode. Headless Chromium handles ES module script execution differently, which prevents the connect script from installing the devtools hook before React loads.

```bash
# Headed mode is required for devtools to connect
agent-browser --session devtools --headed open http://localhost:5173/

# Verify connection
agent-react-devtools status
```
