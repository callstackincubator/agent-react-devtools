import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  createTempStateDir,
  getTestPort,
  startDaemon,
  waitForDaemon,
  stopDaemon,
  connectMockApp,
  sendOperations,
  buildOperations,
  rootOp,
  addOp,
  ELEMENT_TYPE_FUNCTION,
  ELEMENT_TYPE_MEMO,
  ELEMENT_TYPE_HOST,
  runCli,
  sleep,
} from './helpers.js';

describe('CLI commands (e2e)', () => {
  let stateDir: string;
  let port: number;
  let daemon: ChildProcess | null = null;
  let ws: WebSocket | null = null;

  beforeEach(async () => {
    stateDir = createTempStateDir();
    port = getTestPort();
    daemon = startDaemon(port, stateDir);
    await waitForDaemon(stateDir);
    ws = await connectMockApp(port);

    const ops = buildOperations(1, 100, (s) => [
      rootOp(100),
      addOp(1, ELEMENT_TYPE_FUNCTION, 100, s('App')),
      addOp(2, ELEMENT_TYPE_MEMO, 1, s('Header')),
      addOp(3, ELEMENT_TYPE_FUNCTION, 1, s('UserProfile')),
      addOp(4, ELEMENT_TYPE_HOST, 1, s('div')),
    ]);
    sendOperations(ws!, ops);
    await sleep(300);
  });

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await stopDaemon(daemon, stateDir);
    daemon = null;
    ws = null;
  });

  it('should display status', async () => {
    const result = await runCli(['status'], stateDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('running');
    expect(result.stdout).toContain(String(port));
  });

  it('should get component tree', async () => {
    const result = await runCli(['get', 'tree'], stateDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('App');
    expect(result.stdout).toContain('Header');
    expect(result.stdout).toContain('UserProfile');
  });

  it('should find components by name', async () => {
    const result = await runCli(['find', 'User'], stateDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('UserProfile');
  });

  it('should count components', async () => {
    const result = await runCli(['count'], stateDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('5 components');
  });

  it('should show help', async () => {
    const result = await runCli(['--help'], stateDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });
});

describe('CLI commands without an attached app (e2e)', () => {
  let stateDir: string;
  let port: number;
  let daemon: ChildProcess | null = null;

  beforeEach(async () => {
    stateDir = createTempStateDir();
    port = getTestPort();
    daemon = startDaemon(port, stateDir);
    await waitForDaemon(stateDir);
  });

  afterEach(async () => {
    await stopDaemon(daemon, stateDir);
    daemon = null;
  });

  for (const args of [['errors'], ['count'], ['get', 'tree'], ['find', 'App'], ['profile', 'start']]) {
    it(`should fail \`${args.join(' ')}\` instead of reporting an empty result`, async () => {
      const result = await runCli(args, stateDir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No React app is attached');
      expect(result.stderr).toContain(String(port));
      expect(result.stdout).not.toContain('No components');
      expect(result.stdout).not.toContain('0 components');
    });
  }

  it('should still report status and honour wait timeouts', async () => {
    const status = await runCli(['status'], stateDir);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain('0 connected');

    const wait = await runCli(['wait', '--connected', '--timeout', '1'], stateDir);
    expect(wait.exitCode).toBe(1);
  });
});

describe('CLI commands when another DevTools backend attaches (e2e)', () => {
  let stateDir: string;
  let port: number;
  let daemon: ChildProcess | null = null;
  let ws: WebSocket | null = null;

  const fullTree = (rootId: number, base: number) =>
    buildOperations(1, rootId, (s) => [
      rootOp(rootId),
      addOp(base + 1, ELEMENT_TYPE_FUNCTION, rootId, s('App')),
      addOp(base + 2, ELEMENT_TYPE_MEMO, base + 1, s('Header')),
      addOp(base + 3, ELEMENT_TYPE_FUNCTION, base + 1, s('UserProfile')),
      addOp(base + 4, ELEMENT_TYPE_HOST, base + 1, s('div')),
    ]);

  beforeEach(async () => {
    stateDir = createTempStateDir();
    port = getTestPort();
    daemon = startDaemon(port, stateDir);
    await waitForDaemon(stateDir);
    ws = await connectMockApp(port);
    sendOperations(ws!, fullTree(100, 0));
    await sleep(300);
  });

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await stopDaemon(daemon, stateDir);
    daemon = null;
    ws = null;
  });

  it('should replace the frozen tree instead of counting it twice', async () => {
    // React Native DevTools (or another agent) attaching re-flushes the same
    // tree through the shared hook under a fresh fiber-ID space.
    sendOperations(ws!, fullTree(500, 1000));
    await sleep(300);

    const count = await runCli(['count'], stateDir);
    expect(count.stdout).toContain('5 components');

    const found = await runCli(['find', 'UserProfile', '--exact'], stateDir);
    expect(found.stdout.trim().split('\n')).toHaveLength(1);
    expect(found.stdout).toContain('id:1003');
  });

  it('should keep a genuinely different second root', async () => {
    sendOperations(
      ws!,
      buildOperations(1, 500, (s) => [
        rootOp(500),
        addOp(1001, ELEMENT_TYPE_FUNCTION, 500, s('Sidebar')),
      ]),
    );
    await sleep(300);

    const count = await runCli(['count'], stateDir);
    expect(count.stdout).toContain('7 components');
  });
});
