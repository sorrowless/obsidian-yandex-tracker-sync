/**
 * Obsidian ↔ Tracker coarse status via board columns and status tags.
 *
 * Coarse checkbox:
 *   `[ ]` ↔ todo
 *   `[/]` ↔ in_progress
 *   `[?]` ↔ review
 *   `[x]` ↔ done family
 */

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'done'
  );
}

/** Map an Obsidian checkbox character to a synced status. */
export function statusFromCheckbox(checkboxChar: string): TaskStatus | null {
  if (checkboxChar === ' ') {
    return 'todo';
  }
  if (checkboxChar === 'x' || checkboxChar === 'X') {
    return 'done';
  }
  if (checkboxChar === '/') {
    return 'in_progress';
  }
  if (checkboxChar === '?') {
    return 'review';
  }
  return null;
}

/** Checkbox character written back into Obsidian for a status. */
export function checkboxFromStatus(status: TaskStatus): string {
  switch (status) {
    case 'todo':
      return ' ';
    case 'in_progress':
      return '/';
    case 'review':
      return '?';
    case 'done':
      return 'x';
    default: {
      const _exhaustive: never = status;
      return String(_exhaustive);
    }
  }
}

export function doneFlagFromStatus(status: TaskStatus): boolean {
  return status === 'done';
}

export function statusFromDoneFlag(done: boolean): TaskStatus {
  return done ? 'done' : 'todo';
}

/** Status tag title from a board column name: lower-case, spaces → hyphens. */
export function statusLabelFromColumnName(columnName: string): string {
  return columnName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._а-яё-]+/giu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeStatusLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const TODO_NAMES = new Set([
  'to do',
  'todo',
  'to-do',
  'open',
  'открыт',
  'открыто',
  'бэклог',
  'backlog',
  'новый',
  'новая',
]);
const REVIEW_NAMES = new Set([
  'review',
  'in review',
  'ревью',
  'на ревью',
  'code review',
  'на проверке',
  'проверка',
  // Blocked / paused → review ([?]) so they stay visible for periodic attention.
  'blocked',
  'block',
  'заблокирован',
  'заблокировано',
  'заблокирована',
  'блок',
  'paused',
  'приостановлен',
  'приостановлено',
]);
const DONE_NAMES = new Set([
  'done',
  'trashed',
  'canceled',
  'cancelled',
  'closed',
  'resolved',
  'completed',
  'complete',
  'finished',
  'закрыт',
  'закрыто',
  'решен',
  'решено',
  'готово',
  'завершен',
  'завершено',
  'выполнено',
  'выполнен',
  'выполнена',
  'сделано',
]);

export function nameMatchesTodo(name: string): boolean {
  const n = normalizeStatusLabel(name);
  return TODO_NAMES.has(n) || TODO_NAMES.has(name.trim().toLowerCase());
}

export function nameMatchesReview(name: string): boolean {
  const n = normalizeStatusLabel(name);
  if (REVIEW_NAMES.has(n) || REVIEW_NAMES.has(name.trim().toLowerCase())) {
    return true;
  }
  return /(review|ревью|проверк|block|блок|pause|пауза|приостан)/i.test(n);
}

export function nameMatchesDone(name: string): boolean {
  const n = normalizeStatusLabel(name);
  if (DONE_NAMES.has(n) || DONE_NAMES.has(name.trim().toLowerCase())) {
    return true;
  }
  return /(done|closed|resolved|complete|finish|готов|закрыт|завершен|выполнен|решен|сделан)/i.test(
    n,
  );
}

/**
 * Derive coarse TaskStatus from a Tracker status name/display and optional type
 * (`new` | `inProgress` | `paused` | `done` | `cancelled` | …).
 *
 * Blocked / `paused` map to `review` ([?]).
 */
export function statusFromTrackerStatus(
  statusName: string,
  statusType?: string | null,
): TaskStatus {
  const name = statusName.trim().toLowerCase();
  const type = (statusType ?? '').trim().toLowerCase();

  if (
    nameMatchesDone(name) ||
    type === 'done' ||
    type === 'cancelled' ||
    type === 'canceled'
  ) {
    return 'done';
  }
  if (nameMatchesTodo(name) || type === 'new') {
    return 'todo';
  }
  if (nameMatchesReview(name) || type === 'paused') {
    return 'review';
  }
  return 'in_progress';
}

/** @deprecated Use statusFromTrackerStatus */
export const statusFromJiraStatus = statusFromTrackerStatus;

export interface BoardColumnView {
  name: string;
  /** Status keys and/or ids belonging to this column. */
  statusIds: string[];
}

/**
 * Resolve which board column an issue status belongs to.
 * Matches against status key or id (case-insensitive for keys).
 */
export function columnForStatusId(
  columns: ReadonlyArray<BoardColumnView>,
  statusIdOrKey: string,
): BoardColumnView | null {
  const needle = statusIdOrKey.trim().toLowerCase();
  if (!needle) {
    return null;
  }
  for (const column of columns) {
    if (
      column.statusIds.some((id) => id.trim().toLowerCase() === needle)
    ) {
      return column;
    }
  }
  return null;
}

/**
 * Combine issue status name/type with board-column membership.
 * Done and review win from either signal so custom names still map correctly.
 */
export function resolveIssueCoarseStatus(
  statusName: string,
  statusType: string | null | undefined,
  column: BoardColumnView | null,
  statusMeta?: ReadonlyMap<string, { name: string; type?: string }>,
): TaskStatus {
  const fromName = statusFromTrackerStatus(statusName, statusType);
  const fromColumn = column ? inferColumnCoarseStatus(column, statusMeta) : null;

  if (fromName === 'done' || fromColumn === 'done') {
    return 'done';
  }
  if (fromName === 'review' || fromColumn === 'review') {
    return 'review';
  }
  if (fromColumn) {
    return fromColumn;
  }
  return fromName;
}

/**
 * Pick a target column for a coarse Obsidian status when creating/transitioning.
 */
export function pickColumnForCoarseStatus(
  columns: ReadonlyArray<BoardColumnView>,
  status: TaskStatus,
  statusMeta?: ReadonlyMap<string, { name: string; type?: string }>,
): BoardColumnView | null {
  if (columns.length === 0) {
    return null;
  }

  const scored = columns.map((column) => {
    const columnStatus = inferColumnCoarseStatus(column, statusMeta);
    return { column, columnStatus };
  });

  if (status === 'todo') {
    return (
      scored.find((item) => nameMatchesTodo(item.column.name))?.column ??
      scored.find((item) => item.columnStatus === 'todo')?.column ??
      columns[0] ??
      null
    );
  }

  if (status === 'done') {
    // Never fall back to "last column" — wrong board order leaves issues in To Do.
    return (
      scored.find((item) => nameMatchesDone(item.column.name))?.column ??
      scored.find((item) => item.columnStatus === 'done')?.column ??
      null
    );
  }

  if (status === 'review') {
    // Prefer a real Review column over Blocked (both map to coarse review / [?]).
    const isBlockedName = (name: string): boolean =>
      /(block|блок|pause|пауза|приостан)/i.test(normalizeStatusLabel(name));
    return (
      scored.find(
        (item) =>
          nameMatchesReview(item.column.name) && !isBlockedName(item.column.name),
      )?.column ??
      scored.find((item) => item.columnStatus === 'review' && !isBlockedName(item.column.name))
        ?.column ??
      scored.find((item) => nameMatchesReview(item.column.name))?.column ??
      scored.find((item) => item.columnStatus === 'review')?.column ??
      null
    );
  }

  // in_progress → prefer exact "In Progress", else first in_progress column
  // (do not fall back onto Review)
  return (
    scored.find((item) => {
      const n = normalizeStatusLabel(item.column.name);
      return n === 'in progress' || n === 'в работе';
    })?.column ??
    scored.find((item) => item.columnStatus === 'in_progress')?.column ??
    scored.find(
      (item) =>
        item.columnStatus !== 'todo' &&
        item.columnStatus !== 'done' &&
        item.columnStatus !== 'review',
    )?.column ??
    columns[0] ??
    null
  );
}

/**
 * Infer coarse TaskStatus for a board column from its name and/or
 * the Tracker status metadata of statuses placed in that column.
 */
export function inferColumnCoarseStatus(
  column: BoardColumnView,
  statusMeta?: ReadonlyMap<string, { name: string; type?: string }>,
): TaskStatus {
  if (nameMatchesTodo(column.name)) {
    return 'todo';
  }
  if (nameMatchesDone(column.name)) {
    return 'done';
  }
  if (nameMatchesReview(column.name)) {
    return 'review';
  }
  if (statusMeta) {
    const inferred: TaskStatus[] = [];
    for (const statusId of column.statusIds) {
      const meta = statusMeta.get(statusId) ?? statusMeta.get(statusId.toLowerCase());
      if (!meta) {
        continue;
      }
      inferred.push(statusFromTrackerStatus(meta.name, meta.type));
    }
    if (inferred.includes('done')) {
      return 'done';
    }
    if (inferred.includes('review')) {
      return 'review';
    }
    if (inferred.includes('in_progress')) {
      return 'in_progress';
    }
    if (inferred.includes('todo')) {
      return 'todo';
    }
  }
  return statusFromTrackerStatus(column.name);
}

/** Set of status-tag titles belonging to this board's columns. */
export function boardStatusLabelSet(columns: ReadonlyArray<BoardColumnView>): Set<string> {
  return new Set(
    columns
      .map((column) => statusLabelFromColumnName(column.name))
      .filter((label) => label.length > 0),
  );
}
