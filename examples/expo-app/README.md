# Expo Example App

A minimal Expo app showing the React Native 0.87+ `agent-react-devtools`
configuration.

> This fixture currently uses React Native 0.81.5, so its client-side version
> guard intentionally makes the bootstrap a no-op. It validates the Metro and
> application configuration shape, but does not validate the React Native 0.87
> runtime connection.

## Setup

```sh
cd examples/expo-app
bun install
```

## Testing the DevTools Connection

The example already contains both required integration points:

- [`metro.config.js`](metro.config.js) applies `withAgentReactDevTools` to the
  final Expo Metro config.
- [`app/_layout.tsx`](app/_layout.tsx) imports
  `agent-react-devtools/react-native` so the bootstrap is in Metro's dependency
  graph.

This checked-in React Native 0.81 fixture cannot test a live connection. To
exercise the same configuration in an Expo project based on React Native 0.87
or newer, restart Metro and run:

```sh
# Terminal 1: Start the daemon
agent-react-devtools start

# Terminal 2: Start the Expo dev server
cd examples/expo-app
bun start --clear

# Terminal 3: Inspect the app
agent-react-devtools status
agent-react-devtools wait --connected --timeout 30
agent-react-devtools get tree
```

### Physical devices

Forward the DevTools port over USB:

```sh
adb reverse tcp:8097 tcp:8097
```
