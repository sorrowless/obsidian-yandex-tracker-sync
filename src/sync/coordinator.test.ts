import { describe, expect, it } from 'vitest';
import { SyncCoordinator } from './coordinator';

describe('SyncCoordinator', () => {
  it('runs a single request to completion', async () => {
    const coordinator = new SyncCoordinator();
    const seen: Array<{ reason: string; dryRun: boolean }> = [];
    await coordinator.request('manual', false, async (reason, dryRun) => {
      seen.push({ reason, dryRun });
    });
    expect(seen).toEqual([{ reason: 'manual', dryRun: false }]);
    expect(coordinator.isRunning).toBe(false);
  });

  it('coalesces overlapping requests and prefers a real sync over dry-run', async () => {
    const coordinator = new SyncCoordinator();
    const seen: Array<{ reason: string; dryRun: boolean }> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = coordinator.request('preview', true, async (reason, dryRun) => {
      seen.push({ reason, dryRun });
      if (seen.length === 1) {
        await gate;
      }
    });

    await Promise.resolve();
    void coordinator.request('file-change', false, async () => {
      // unused — coordinator reuses the first runner
    });
    void coordinator.request('interval', false, async () => {
      // unused
    });

    release();
    await first;
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual([
      { reason: 'preview', dryRun: true },
      { reason: 'interval', dryRun: false },
    ]);
    expect(coordinator.isRunning).toBe(false);
  });
});
