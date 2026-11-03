/** Dataview inline field key for Tracker time spent (seconds). */
export const TIMESPENT_FIELD_KEY = 'timespent';

const TIMESPENT_FIELD_RE = /\[timespent::\s*([^\]]+?)\]/giu;

/**
 * Extract `[timespent:: N]` from task-line text.
 * Only non-negative integer seconds are accepted.
 */
export function parseTimeSpentField(text: string): {
  timeSpentSeconds: number | null;
  remainder: string;
} {
  let timeSpentSeconds: number | null = null;
  const remainder = text
    .replace(TIMESPENT_FIELD_RE, (_match, raw: string) => {
      const parsed = normalizeTimeSpentSeconds(raw);
      if (parsed !== null && timeSpentSeconds === null) {
        timeSpentSeconds = parsed;
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { timeSpentSeconds, remainder };
}

/** Trailing Dataview field (leading space when set). */
export function formatTimeSpentSuffix(seconds: number | null | undefined): string {
  const value = normalizeTimeSpentSeconds(seconds);
  if (value === null) {
    return '';
  }
  return ` [${TIMESPENT_FIELD_KEY}:: ${value}]`;
}

/** Non-negative integer seconds, or null when unset/invalid. Zero is kept. */
export function normalizeTimeSpentSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    return Math.floor(value);
  }
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
