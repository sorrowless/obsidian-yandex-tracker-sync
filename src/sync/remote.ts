import type { TrackerBoardColumn, TrackerIssue } from '../tracker/types';
import {
  trackerAssigneeDisplayName,
  trackerAssigneeIdentity,
} from './assignee';
import {
  resolveIssueDates,
  type DueDateSource,
  type StartDateSource,
} from './issue-dates';
import { normalizeDescription } from './ledger';
import {
  columnForStatusId,
  resolveIssueCoarseStatus,
  type BoardColumnView,
  type TaskStatus,
} from './status';
import { trackerSpentToSeconds } from './timespent';

export interface RemoteIssueView {
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** Tracker status key (falls back to id). */
  trackerStatusId: string;
  /** Tracker status display name (falls back to key). */
  trackerStatusName: string;
  columnName: string;
  /** Native Tracker parent issue key (NOT Blocks links). */
  parentIssueKey: string | null;
  /** Tracker tags (kept as `labels` for engine compatibility). */
  labels: string[];
  startDate: string | null;
  dueDate: string | null;
  startDateSource: StartDateSource;
  dueDateSource: DueDateSource;
  /** Raw Tracker `start` (normalized). */
  trackerStartDate: string | null;
  /** Stable Tracker assignee id (id, falling back to login), or null. */
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  /** Logged time spent in seconds (from Tracker `spent` ms), or null. */
  timeSpentSeconds: number | null;
  updated: string;
  projectKey: string;
  isSubtask: boolean;
}

export interface RemoteIssueViewOptions {
  /**
   * Status metadata keyed by status key/id (lower-case key preferred),
   * used to derive coarse status from Tracker status `type`.
   */
  statusMeta?: ReadonlyMap<string, { name: string; type?: string }>;
}

export interface IndexedRemoteIssues {
  remoteMap: Map<string, RemoteIssueView>;
}

export function indexRemoteIssues(
  issues: readonly TrackerIssue[],
  columns: ReadonlyArray<BoardColumnView>,
  options: RemoteIssueViewOptions = {},
): IndexedRemoteIssues {
  const remoteMap = new Map<string, RemoteIssueView>();
  for (const issue of issues) {
    const view = toRemoteIssueView(issue, columns, options);
    remoteMap.set(view.key, view);
  }
  // Nesting only makes sense inside the sync set: a parent outside this board /
  // tag filter can never be rendered in the note, so treat it as "no parent"
  // (otherwise the local/remote parent hash would never converge).
  for (const view of remoteMap.values()) {
    if (view.parentIssueKey !== null && !remoteMap.has(view.parentIssueKey)) {
      view.parentIssueKey = null;
    }
  }
  return { remoteMap };
}

export function toRemoteIssueView(
  issue: TrackerIssue,
  columns: ReadonlyArray<BoardColumnView>,
  options: RemoteIssueViewOptions = {},
): RemoteIssueView {
  const statusKey = String(issue.status?.key ?? '').trim();
  const statusIdRaw = issue.status?.id;
  const statusId = statusKey || (statusIdRaw !== undefined ? String(statusIdRaw) : '');
  const statusName = String(issue.status?.display ?? issue.status?.key ?? '').trim();

  const column =
    (statusKey ? columnForStatusId(columns, statusKey) : null) ??
    (statusIdRaw !== undefined ? columnForStatusId(columns, String(statusIdRaw)) : null);
  const columnName = column?.name ?? statusName;

  const meta =
    options.statusMeta?.get(statusKey) ??
    options.statusMeta?.get(statusKey.toLowerCase()) ??
    (statusIdRaw !== undefined ? options.statusMeta?.get(String(statusIdRaw)) : undefined);
  // Issue payloads sometimes embed status.type; fall back to listStatuses meta.
  const embeddedType =
    typeof (issue.status as { type?: unknown } | undefined)?.type === 'string'
      ? String((issue.status as { type?: string }).type)
      : null;
  const statusType = embeddedType ?? meta?.type ?? null;

  const status: TaskStatus = resolveIssueCoarseStatus(
    statusName || statusKey,
    statusType,
    column,
    options.statusMeta,
  );

  const dates = resolveIssueDates(issue);
  const assignee = issue.assignee ?? null;
  const parentKey = issue.parent?.key ? String(issue.parent.key).toUpperCase() : null;
  const key = String(issue.key).toUpperCase();

  return {
    key,
    title: String(issue.summary ?? ''),
    description: normalizeDescription(String(issue.description ?? '')),
    status,
    trackerStatusId: statusId,
    trackerStatusName: statusName || statusKey,
    columnName,
    parentIssueKey: parentKey,
    labels: Array.isArray(issue.tags) ? issue.tags.map(String) : [],
    startDate: dates.startDate,
    dueDate: dates.dueDate,
    startDateSource: dates.startDateSource,
    dueDateSource: dates.dueDateSource,
    trackerStartDate: dates.trackerStartDate,
    assigneeAccountId: trackerAssigneeIdentity(assignee),
    assigneeDisplayName: trackerAssigneeDisplayName(assignee) || null,
    timeSpentSeconds: trackerSpentToSeconds(issue.spent),
    updated: String(issue.updatedAt ?? ''),
    projectKey: String(issue.queue?.key ?? key.split('-')[0] ?? ''),
    isSubtask: Boolean(issue.parent?.key),
  };
}

/** Build column views (status keys + ids + display) from Tracker board columns. */
export function columnsFromBoardConfig(
  columns: readonly TrackerBoardColumn[],
): BoardColumnView[] {
  return columns.map((column) => {
    const statusIds: string[] = [];
    const seen = new Set<string>();
    const pushId = (value: string): void => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      statusIds.push(trimmed);
    };
    for (const status of column.statuses ?? []) {
      if (status.key) {
        pushId(String(status.key));
      }
      if (status.id !== undefined && status.id !== null && status.id !== '') {
        pushId(String(status.id));
      }
      if (status.display) {
        pushId(String(status.display));
      }
    }
    return {
      name: String(column.name ?? column.display ?? column.id),
      statusIds,
    };
  });
}
