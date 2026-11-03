/**
 * Yandex Tracker query language helpers for board issue search filters.
 */

export type RecencyUnit = 'days' | 'months';
export type RecencyField = 'updated' | 'created';

export function isRecencyUnit(value: unknown): value is RecencyUnit {
  return value === 'days' || value === 'months';
}

export function isRecencyField(value: unknown): value is RecencyField {
  return value === 'updated' || value === 'created';
}

export interface RecencyFilter {
  field: RecencyField;
  value: number;
  unit: RecencyUnit;
}

/** Escape a literal for Tracker query string values. */
export function escapeQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Quote a query token when it contains spaces or special chars. */
export function quoteQueryValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '""';
  }
  if (/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return trimmed;
  }
  return `"${escapeQueryLiteral(trimmed)}"`;
}

/**
 * Build a relative recency clause, e.g. `Updated: >today()-30d`.
 * Tracker accepts relative dates with `today()-Nd` / `today()-NM`.
 */
export function buildRecencyClause(filter: RecencyFilter): string | null {
  const n = Math.floor(filter.value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  const field = filter.field === 'created' ? 'Created' : 'Updated';
  const unit = filter.unit === 'months' ? 'M' : 'd';
  return `${field}: >today()-${n}${unit}`;
}

/**
 * OR-join tag filters: `Tags: a OR Tags: b`.
 * Empty list → no clause.
 */
export function buildTagsClause(tags: readonly string[]): string | null {
  const cleaned = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (cleaned.length === 0) {
    return null;
  }
  return cleaned.map((tag) => `Tags: ${quoteQueryValue(tag)}`).join(' OR ');
}

/**
 * Combine board query with optional tag OR-group and recency (AND).
 * Tag group is parenthesized when more than one tag.
 */
export function combineQueryParts(
  boardQuery: string | null | undefined,
  tags: readonly string[] = [],
  recency: RecencyFilter | null = null,
): string {
  const parts: string[] = [];
  const board = (boardQuery ?? '').trim();
  if (board) {
    parts.push(board.includes(' OR ') || board.includes(' AND ') ? `(${board})` : board);
  }

  const tagsClause = buildTagsClause(tags);
  if (tagsClause) {
    parts.push(tagsClause.includes(' OR ') ? `(${tagsClause})` : tagsClause);
  }

  const recencyClause = recency ? buildRecencyClause(recency) : null;
  if (recencyClause) {
    parts.push(recencyClause);
  }

  return parts.join(' AND ');
}

/**
 * Official Tracker query-language clause for issues belonging to a board.
 * Do **not** use `Board: <id>` — that is parsed as a saved Filter named "Board"
 * and fails with “filter board does not exist”.
 *
 * @see https://yandex.ru/support/tracker/en/user/query-filter
 */
export function boardScopeQuery(boardId: number): string {
  return `"Sprints By Board": ${Math.floor(boardId)}`;
}

/** Queue-scoped fallback when a board has no query/filter/sprints. */
export function queueScopeQuery(queueKey: string): string {
  const key = queueKey.trim();
  if (!key) {
    return '';
  }
  return `Queue: ${quoteQueryValue(key)}`;
}

/**
 * `Status: key1, key2, ...` from board column status keys/displays.
 * Skips pure numeric ids — mixing them into Status: often makes Tracker reject
 * the whole query (silent miss of Blocked / custom columns).
 */
export function columnStatusesClause(
  statusIds: readonly string[],
): string | null {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of statusIds) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    // Numeric status ids are valid in API refs but unreliable in query language.
    if (/^\d+$/.test(trimmed)) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(quoteQueryValue(trimmed));
  }
  if (values.length === 0) {
    return null;
  }
  return `Status: ${values.join(', ')}`;
}

/** Issues with Tracker status type paused (Blocked / Need Info / …). */
export function pausedStatusTypeClause(): string {
  return '"Status Type": paused';
}

/** True when a board column name looks like Blocked / paused parking. */
export function isBlockedColumnName(name: string): boolean {
  return /(block|блок|pause|пауза|приостан)/i.test(name.trim());
}
