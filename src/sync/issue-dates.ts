import {
  normalizeTrackerDate,
  toTrackerDueDatePayload,
} from '../note/dates';

/** Minimal date-bearing shape of a Tracker issue. */
export interface TrackerIssueDates {
  start?: string | null;
  end?: string | null;
  deadline?: string | null;
}

export type DueDateSource = 'end' | 'deadline' | null;
export type StartDateSource = 'start' | null;

export interface ResolvedIssueDates {
  startDate: string | null;
  dueDate: string | null;
  dueDateSource: DueDateSource;
  startDateSource: StartDateSource;
  /** Raw Tracker `start` (normalized to ISO), same as startDate. */
  trackerStartDate: string | null;
  /** Normalized Tracker `end`. */
  end: string | null;
  /** Normalized Tracker `deadline`. */
  deadline: string | null;
}

/**
 * Resolve Obsidian start/due from Tracker fields:
 * - start ← issue.start
 * - due ← issue.end if set, else issue.deadline
 * Obsidian writes `deadline` only (never `end`).
 */
export function resolveIssueDates(
  issue: TrackerIssueDates | null | undefined,
): ResolvedIssueDates {
  const startDate = normalizeTrackerDate(issue?.start);
  const end = normalizeTrackerDate(issue?.end);
  const deadline = normalizeTrackerDate(issue?.deadline);

  let dueDate: string | null = null;
  let dueDateSource: DueDateSource = null;
  if (end) {
    dueDate = end;
    dueDateSource = 'end';
  } else if (deadline) {
    dueDate = deadline;
    dueDateSource = 'deadline';
  }

  return {
    startDate,
    dueDate,
    dueDateSource,
    startDateSource: startDate ? 'start' : null,
    trackerStartDate: startDate,
    end,
    deadline,
  };
}

/** Build create/update payload: Obsidian start/due → Tracker start/deadline. */
export function buildTrackerDatePayload(input: {
  startDate?: string | null;
  dueDate?: string | null;
}): { start: string | null; deadline: string | null } {
  return {
    start: toTrackerDueDatePayload(input.startDate ?? null),
    deadline: toTrackerDueDatePayload(input.dueDate ?? null),
  };
}

export function subtractSecondsFromIso(iso: string, seconds: number): string | null {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime()) || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return new Date(dt.getTime() - Math.floor(seconds) * 1000).toISOString();
}

/** Compact duration for notices: `1h`, `1h 30m`, `2d 3h`. */
export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds === 0) {
    return '0m';
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes}m`);
  }
  if (parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(' ');
}
