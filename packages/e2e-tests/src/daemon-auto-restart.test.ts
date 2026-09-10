import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createTempStateDir,
  getTestPort,
  runCli,
} from './helpers.js';

describe('Daemon auto-restart on rebuild', () => {
  let stateDir: string;
  let port: number;

  beforeEach(async () => {
    stateDir = createTempStateDir();
    port = getTestPort();

    const result = await runCli(['start', `--port`, `${port}`], stateDir);
    expect(result.exitCode).toBe(0);
  });

  afterEach(async () => {
    await runCli(['stop'], stateDir);
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should restart daemon when daemon.js has been rebuilt', async () => {
    const infoPath = path.join(stateDir, 'daemon.json');
    const infoBefore = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));

    // Simulate a rebuild by changing the stored buildMtime so it no longer
    // matches the actual daemon.js mtime
    infoBefore.buildMtime = 1000;
    fs.writeFileSync(infoPath, JSON.stringify(infoBefore, null, 2));

    // Any command routed through ensureDaemon exercises the rebuild check.
    // `get tree` refuses with no app attached, which is beside the point here:
    // reaching the daemon at all is what proves the restart happened.
    const result = await runCli(['get', 'tree'], stateDir);
    expect(result.stderr).toContain('No app is connected');

    const infoAfter = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    expect(infoAfter.pid).not.toBe(infoBefore.pid);
    expect(infoAfter.port).toBe(port);
  });

  it('should not restart when daemon is up to date', async () => {
    const infoPath = path.join(stateDir, 'daemon.json');
    const infoBefore = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));

    const result = await runCli(['get', 'tree'], stateDir);
    expect(result.stderr).toContain('No app is connected');

    const infoAfter = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    expect(infoAfter.pid).toBe(infoBefore.pid);
  });
});
