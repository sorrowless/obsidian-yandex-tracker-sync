/**
 * Single-flight sync runner with coalesce-to-one follow-up.
 * Overlapping requests set a flag; after the active run finishes, one more run executes.
 * If any queued request asks for a real sync, the follow-up is not a dry-run.
 */
export class SyncCoordinator {
  private running = false;
  private queued: SyncQueueItem | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  async request(
    reason: string,
    dryRun: boolean,
    run: (reason: string, dryRun: boolean) => Promise<void>,
  ): Promise<void> {
    if (this.running) {
      if (this.queued) {
        this.queued = {
          reason,
          dryRun: this.queued.dryRun && dryRun,
        };
      } else {
        this.queued = { reason, dryRun };
      }
      return;
    }

    this.running = true;
    try {
      let activeReason = reason;
      let activeDryRun = dryRun;
      for (;;) {
        this.queued = null;
        await run(activeReason, activeDryRun);
        // Class-field narrowing is not reset across `await`; read via assertion.
        const followUp = this.queued as SyncQueueItem | null;
        if (!followUp) {
          break;
        }
        activeReason = followUp.reason;
        activeDryRun = followUp.dryRun;
      }
    } finally {
      this.running = false;
      this.queued = null;
    }
  }
}

interface SyncQueueItem {
  reason: string;
  dryRun: boolean;
}
