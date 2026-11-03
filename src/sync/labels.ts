import type { TrackerClient } from '../tracker/client';
import {
  boardStatusLabelSet,
  statusLabelFromColumnName,
  type BoardColumnView,
} from './status';

/**
 * Ensure issue tags match the board column for status tags.
 * Works on string[] Tracker tags.
 * Column wins: remove other board status tags, keep non-status tags, add desired.
 */
export async function reconcileStatusLabels(
  client: TrackerClient,
  issueKey: string,
  currentLabels: readonly string[],
  columnName: string,
  columns: ReadonlyArray<BoardColumnView>,
  dryRun: boolean,
): Promise<{ labels: string[]; changed: boolean }> {
  const statusSet = boardStatusLabelSet(columns);
  const desired = statusLabelFromColumnName(columnName);
  if (!desired) {
    return { labels: [...currentLabels], changed: false };
  }

  const nonStatus = currentLabels.filter(
    (label) => !statusSet.has(label.trim().toLowerCase()),
  );
  const next = [...nonStatus];
  if (!next.some((label) => label.trim().toLowerCase() === desired)) {
    next.push(desired);
  }

  const currentNormalized = [...currentLabels].map((l) => l.trim().toLowerCase()).sort();
  const nextNormalized = next.map((l) => l.trim().toLowerCase()).sort();
  const changed =
    currentNormalized.length !== nextNormalized.length ||
    currentNormalized.some((value, index) => value !== nextNormalized[index]);

  if (!changed) {
    return { labels: [...currentLabels], changed: false };
  }

  if (!dryRun) {
    await client.updateIssue(issueKey, { tags: next });
  }
  return { labels: next, changed: true };
}

export function desiredStatusLabel(columnName: string): string {
  return statusLabelFromColumnName(columnName);
}
