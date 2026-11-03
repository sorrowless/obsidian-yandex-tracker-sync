import {
  buildRecencyClause,
  buildTagsClause,
  combineQueryParts,
  type RecencyFilter,
} from './query';

/** Filters applied when loading issues for a board mapping. */
export interface IssueSyncFilter {
  tags?: readonly string[];
  /** Alias kept for callers that still say “labels”. */
  labels?: readonly string[];
  recency?: RecencyFilter | null;
  /**
   * Queue key override (mapping queue). Used for backlog / paused / column-status
   * searches when the board has no `defaultQueue` or it differs from the mapping.
   */
  queueKey?: string;
}

export function normalizeIssueSyncFilter(
  filter: IssueSyncFilter | readonly string[] = {},
  recency?: RecencyFilter | null,
): IssueSyncFilter {
  if (Array.isArray(filter)) {
    return {
      tags: filter.map(String),
      recency: recency ?? null,
    };
  }
  const obj = filter as IssueSyncFilter;
  const tags = obj.tags ?? obj.labels ?? [];
  const queueKey = String(obj.queueKey ?? '').trim();
  return {
    tags,
    recency: obj.recency !== undefined ? obj.recency : (recency ?? null),
    queueKey: queueKey || undefined,
  };
}

/** Full Tracker query for sync (board query already folded in by the client). */
export function buildSyncQuery(
  boardQuery: string | null | undefined,
  filter: IssueSyncFilter,
): string {
  return combineQueryParts(boardQuery, filter.tags ?? filter.labels ?? [], filter.recency ?? null);
}

export function describeIssueSyncFilter(filter: IssueSyncFilter): string {
  const bits: string[] = [];
  const tags = (filter.tags ?? filter.labels ?? [])
    .map((tag) => String(tag).trim())
    .filter(Boolean);
  const tagsClause = buildTagsClause(tags);
  if (tagsClause) {
    bits.push(tagsClause);
  }
  const recency = buildRecencyClause(filter.recency ?? { field: 'updated', value: 0, unit: 'days' });
  // buildRecencyClause returns null for value <= 0
  if (filter.recency && filter.recency.value > 0) {
    const clause = buildRecencyClause(filter.recency);
    if (clause) {
      bits.push(clause);
    }
  }
  return bits.length > 0 ? bits.join(' AND ') : 'no extra filters';
}
