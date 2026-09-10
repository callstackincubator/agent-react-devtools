import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  createTempStateDir,
  getTestPort,
  startDaemon,
  waitForDaemon,
  stopDaemon,
  sendIpcCommand,
  connectMockApp,
  sendOperations,
  buildOperations,
  rootOp,
  addOp,
  ELEMENT_TYPE_FUNCTION,
  sleep,
} from './helpers.js';

describe('Connection health (e2e)', () => {
  let stateDir: string;
  let port: number;
  let daemon: ChildProcess | null = null;
  let socketPath: string;

  beforeEach(async () => {
    stateDir = createTempStateDir();
    port = getTestPort();
    daemon = startDaemon(port, stateDir);
    await waitForDaemon(stateDir);
    socketPath = path.join(stateDir, 'daemon.sock');
  });

  afterEach(async () => {
    await stopDaemon(daemon, stateDir);
    daemon = null;
  });

  it('should show connection events in status', async () => {
    const ws = await connectMockApp(port);
    await sleep(300);

    const resp = await sendIpcCommand(socketPath, { type: 'status' });
    expect(resp.ok).toBe(true);
    const data = resp.data as {
      connection: {
        connectedApps: number;
        hasEverConnected: boolean;
        recentEvents: Array<{ type: string; timestamp: number }>;
      };
    };
    expect(data.connection.hasEverConnected).toBe(true);
    expect(data.connection.connectedApps).toBe(1);
    expect(data.connection.recentEvents.length).toBeGreaterThan(0);
    expect(data.connection.recentEvents[0].type).toBe('connected');

    ws.close();
    await sleep(300);
  });

  it('should detect reconnection within window', async () => {
    // First connection
    const ws1 = await connectMockApp(port);
    await sleep(300);

    // Disconnect
    ws1.close();
    await sleep(300);

    // Reconnect within 5s window
    const ws2 = await connectMockApp(port);
    await sleep(300);

    const resp = await sendIpcCommand(socketPath, { type: 'status' });
    expect(resp.ok).toBe(true);
    const data = resp.data as {
      connection: {
        recentEvents: Array<{ type: string }>;
      };
    };
    // Last event should be 'reconnected'
    const lastEvent = data.connection.recentEvents[data.connection.recentEvents.length - 1];
    expect(lastEvent.type).toBe('reconnected');

    ws2.close();
    await sleep(300);
  });

  it('should refuse a tree read after disconnect and say how long ago it happened', async () => {
    const ws = await connectMockApp(port);
    await sleep(300);

    // Send a tree
    const ops = buildOperations(1, 200, (s) => [
      rootOp(200),
      addOp(1, ELEMENT_TYPE_FUNCTION, 200, s('App')),
    ]);
    sendOperations(ws, ops);
    await sleep(200);

    // Disconnect
    ws.close();
    await sleep(300);

    // The tree is empty because nothing is attached, not because nothing
    // matched: answering `ok` here made a read that observed nothing look
    // like a read that found nothing.
    const resp = await sendIpcCommand(socketPath, { type: 'get-tree' });
    expect(resp.ok).toBe(false);
    expect(resp.code).toBe('NO_APP_CONNECTED');
    expect(resp.error).toContain('disconnected');
    expect(resp.data).toBeUndefined();
  });

  it('wait --connected should resolve immediately when already connected', async () => {
    const ws = await connectMockApp(port);
    await sleep(300);

    const resp = await sendIpcCommand(
      socketPath,
      { type: 'wait', condition: 'connected', timeout: 2000 },
      5000,
    );
    expect(resp.ok).toBe(true);
    const data = resp.data as { met: boolean; condition: string };
    expect(data.met).toBe(true);
    expect(data.condition).toBe('connected');

    ws.close();
    await sleep(300);
  });

  it('wait --connected should resolve when app connects later', async () => {
    // Start wait before connecting
    const waitPromise = sendIpcCommand(
      socketPath,
      { type: 'wait', condition: 'connected', timeout: 5000 },
      10_000,
    );

    // Connect after a delay
    await sleep(500);
    const ws = await connectMockApp(port);

    const resp = await waitPromise;
    expect(resp.ok).toBe(true);
    const data = resp.data as { met: boolean };
    expect(data.met).toBe(true);

    ws.close();
    await sleep(300);
  });

  it('wait --connected should time out when no app connects', async () => {
    const resp = await sendIpcCommand(
      socketPath,
      { type: 'wait', condition: 'connected', timeout: 1000 },
      5000,
    );
    expect(resp.ok).toBe(true);
    const data = resp.data as { met: boolean; timeout: boolean };
    expect(data.met).toBe(false);
    expect(data.timeout).toBe(true);
  });

  it('wait --component should resolve when the named component appears', async () => {
    const ws = await connectMockApp(port);
    await sleep(300);

    // Start waiting for Counter to appear
    const waitPromise = sendIpcCommand(
      socketPath,
      { type: 'wait', condition: 'component', name: 'Counter', timeout: 5000 },
      10_000,
    );

    // Send operations after a delay
    await sleep(500);
    const ops = buildOperations(1, 300, (s) => [
      rootOp(300),
      addOp(301, ELEMENT_TYPE_FUNCTION, 300, s('Counter')),
      addOp(302, ELEMENT_TYPE_FUNCTION, 300, s('Button')),
    ]);
    sendOperations(ws, ops);

    const resp = await waitPromise;
    expect(resp.ok).toBe(true);
    const data = resp.data as { met: boolean; condition: string };
    expect(data.met).toBe(true);
    expect(data.condition).toBe('component');

    ws.close();
    await sleep(300);
  });
});
