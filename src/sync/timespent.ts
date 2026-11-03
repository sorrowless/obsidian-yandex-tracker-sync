import { normalizeTimeSpentSeconds } from '../note/timespent';

/**
 * Convert Tracker `spent` to whole seconds for Obsidian.
 * Tracker reports `spent` in milliseconds (number or numeric string).
 * ISO-8601 duration strings (`PT1H30M`, `P1DT2H`) are accepted as a fallback.
 */
export function trackerSpentToSeconds(spent: unknown): number | null {
  if (spent === null || spent === undefined || spent === '') {
    return null;
  }
  if (typeof spent === 'number') {
    if (!Number.isFinite(spent) || spent <= 0) {
      return null;
    }
    return Math.floor(spent / 1000);
  }
  const text = String(spent).trim();
  if (/^\d+$/.test(text)) {
    const ms = Number.parseInt(text, 10);
    return ms > 0 ? Math.floor(ms / 1000) : null;
  }
  const iso = text.match(
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );
  if (iso && text.length > 1) {
    const weeks = Number(iso[1] ?? 0);
    const days = Number(iso[2] ?? 0);
    const hours = Number(iso[3] ?? 0);
    const minutes = Number(iso[4] ?? 0);
    const seconds = Number(iso[5] ?? 0);
    const total = Math.floor(
      weeks * 7 * 86400 + days * 86400 + hours * 3600 + minutes * 60 + seconds,
    );
    return total > 0 ? total : null;
  }
  return null;
}

/** Read time spent (seconds) from a Tracker issue's `spent` field. */
export function extractTrackerTimeSpentSeconds(
  issue: { spent?: unknown } | null | undefined,
): number | null {
  return trackerSpentToSeconds(issue?.spent);
}

export type TimeSpentReconcileDecision =
  | { action: 'none' }
  | { action: 'set-local'; seconds: number; detail: string };

/**
 * Pull-only: when Tracker has time spent and Obsidian is empty or differs, set Obsidian.
 * Caller must skip when both sides are done. Never pushes to Tracker.
 */
export function decideTimeSpentReconcile(input: {
  localSeconds: number | null | undefined;
  remoteSeconds: number | null | undefined;
}): TimeSpentReconcileDecision {
  const remote = normalizeTimeSpentSeconds(input.remoteSeconds);
  if (remote === null || remote <= 0) {
    return { action: 'none' };
  }
  const local = normalizeTimeSpentSeconds(input.localSeconds);
  if (local === remote) {
    return { action: 'none' };
  }
  return {
    action: 'set-local',
    seconds: remote,
    detail: `set [timespent:: ${remote}] from Tracker (${remote}s)`,
  };
}
