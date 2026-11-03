/** Obsidian Tasks–style start marker → Tracker `start`. */
export const START_DATE_EMOJI = '🛫';
/** Due marker → Tracker `deadline`. */
export const DUE_DATE_EMOJI = '📅';

/** @deprecated Alias kept for Vikunja-port familiarity; means due date here. */
export const END_DATE_EMOJI = DUE_DATE_EMOJI;

const DATE_VALUE =
  '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?';

const DATE_TOKEN_RE = new RegExp(
  `(?:^|\\s)(${START_DATE_EMOJI}|${DUE_DATE_EMOJI})\\s+(${DATE_VALUE})`,
  'gu',
);

export interface ParsedTaskDates {
  /** ISO-8601 UTC, or null when unset. */
  startDate: string | null;
  /** ISO-8601 UTC, or null when unset. Synced to Tracker deadline (date part). */
  dueDate: string | null;
  /** Body text with date tokens removed. */
  remainder: string;
}

/**
 * Extract start/due date tokens from a task-line body (or trailing suffix).
 * Title text is whatever remains after removing the emoji date tokens.
 */
export function parseTaskDates(text: string): ParsedTaskDates {
  let startDate: string | null = null;
  let dueDate: string | null = null;
  const remainder = text
    .replace(DATE_TOKEN_RE, (_, emoji: string, value: string) => {
      const iso = parseFlexibleDate(value);
      if (iso) {
        if (emoji === START_DATE_EMOJI) {
          startDate = iso;
        } else if (emoji === DUE_DATE_EMOJI) {
          dueDate = iso;
        }
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  return { startDate, dueDate, remainder };
}

/** Format a trailing suffix for the note line (leading space when non-empty). */
export function formatTaskDatesSuffix(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): string {
  const parts: string[] = [];
  if (startDate) {
    parts.push(`${START_DATE_EMOJI} ${formatDateForNote(startDate)}`);
  }
  if (dueDate) {
    parts.push(`${DUE_DATE_EMOJI} ${formatDateForNote(dueDate)}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** Normalize a Tracker date/datetime string to ISO UTC, or null when unset. */
export function normalizeTrackerDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return parseFlexibleDate(value.trim());
}

/** Tracker `deadline` payload: `YYYY-MM-DD` or null. */
export function toTrackerDueDatePayload(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const local = formatDateForNote(iso);
  return local.slice(0, 10);
}

/**
 * Parse a flexible date/time into ISO UTC.
 * Naive values (no timezone) are interpreted in the local timezone.
 */
export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 0;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const tz = match[7];

  if (tz) {
    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  const local = new Date(year, month, day, hour, minute, second);
  if (
    Number.isNaN(local.getTime()) ||
    local.getFullYear() !== year ||
    local.getMonth() !== month ||
    local.getDate() !== day
  ) {
    return null;
  }
  return local.toISOString();
}

/** Human-facing note form: `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` in local time. */
export function formatDateForNote(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return iso;
  }
  const yyyy = String(dt.getFullYear());
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hour = dt.getHours();
  const minute = dt.getMinutes();
  const second = dt.getSeconds();
  if (hour === 0 && minute === 0 && second === 0) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return `${yyyy}-${mm}-${dd} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** @deprecated Use normalizeTrackerDate */
export const normalizeJiraDate = normalizeTrackerDate;
/** @deprecated Use toTrackerDueDatePayload */
export const toJiraDueDatePayload = toTrackerDueDatePayload;
