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

// A component read with no app attached answers from an empty tree, which is
// indistinguishable from "nothing matched": a check that was never performed
// reads as a check that passed. Every read must refuse instead.
const COMPONENT_READS = [
  { label: 'get-tree', command: { type: 'get-tree' } },
  { label: 'get-component', command: { type: 'get-component', id: 1 } },
  { label: 'find', command: { type: 'find', name: 'App' } },
  { label: 'count', command: { type: 'count' } },
  { label: 'errors', command: { type: 'errors' } },
] as const;

describe('Component reads require an attached app (e2e)', () => {
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

  for (const { label, command } of COMPONENT_READS) {
    it(`should refuse ${label} when no app has ever connected`, async () => {
      const resp = await sendIpcCommand(socketPath, command as never);

      expect(resp.ok).toBe(false);
      expect(resp.code).toBe('NO_APP_CONNECTED');
      expect(resp.error).toContain('No app is connected');
      // Nothing has ever attached, so there is no disconnect to describe.
      expect(resp.error).not.toContain('disconnected');
    });
  }

  it('should refuse a read issued after the app disconnected, not answer from its stale tree', async () => {
    const ws = await connectMockApp(port);
    sendOperations(
      ws,
      buildOperations(1, 100, (s) => [
        rootOp(100),
        addOp(1, ELEMENT_TYPE_FUNCTION, 100, s('App')),
      ]),
    );
    await sleep(200);

    const attached = await sendIpcCommand(socketPath, { type: 'find', name: 'App' });
    expect(attached.ok).toBe(true);
    expect(attached.data).toHaveLength(1);

    ws.close();
    await sleep(300);

    const afterDisconnect = await sendIpcCommand(socketPath, { type: 'find', name: 'App' });
    expect(afterDisconnect.ok).toBe(false);
    expect(afterDisconnect.code).toBe('NO_APP_CONNECTED');
    expect(afterDisconnect.error).toContain('disconnected');

    const errors = await sendIpcCommand(socketPath, { type: 'errors' });
    expect(errors.ok).toBe(false);
    expect(errors.code).toBe('NO_APP_CONNECTED');
  });

  it('should answer component reads while an app is attached', async () => {
    const ws = await connectMockApp(port);
    sendOperations(
      ws,
      buildOperations(1, 100, (s) => [
        rootOp(100),
        addOp(1, ELEMENT_TYPE_FUNCTION, 100, s('App')),
      ]),
    );
    await sleep(200);

    for (const { command } of COMPONENT_READS) {
      // `get-component` resolves a real id here; the others take no argument.
      const resp = await sendIpcCommand(socketPath, command as never);
      expect(resp.code).toBeUndefined();
    }

    const errors = await sendIpcCommand(socketPath, { type: 'errors' });
    expect(errors.ok).toBe(true);
    expect(errors.data).toEqual([]);

    ws.close();
  });

  it('should keep status and wait answerable with nothing attached', async () => {
    const status = await sendIpcCommand(socketPath, { type: 'status' });

    expect(status.ok).toBe(true);
    expect((status.data as { connectedApps: number }).connectedApps).toBe(0);
  });
});
