import type { TrackerBoard } from './types';

export interface BoardQueueGroup {
  /** Stable key for grouping (`DOC`, or `__other__` when queue is missing). */
  key: string;
  /** Human label shown in the queue/project picker. */
  label: string;
  boards: TrackerBoard[];
}

/** Queue key from board defaultQueue, with fallbacks. */
export function boardQueueKey(board: TrackerBoard): string {
  const key = board.defaultQueue?.key?.trim();
  if (key) {
    return key.toUpperCase();
  }
  return '__other__';
}

export function boardQueueLabel(board: TrackerBoard): string {
  const key = board.defaultQueue?.key?.trim();
  const name = board.defaultQueue?.display?.trim() || '';
  if (key && name && name.toLowerCase() !== key.toLowerCase()) {
    return `${key.toUpperCase()} — ${name}`;
  }
  if (key) {
    return key.toUpperCase();
  }
  if (name) {
    return name;
  }
  return 'Other (no default queue)';
}

/** One-line label for a board in pickers and settings. */
export function formatBoardOption(board: TrackerBoard): string {
  const queue = board.defaultQueue?.key?.trim().toUpperCase();
  if (queue) {
    return `${queue} / ${board.name} (#${board.id})`;
  }
  return `${board.name} (#${board.id})`;
}

/** Short label stored/shown after a board is chosen. */
export function formatBoardSummary(board: TrackerBoard): string {
  const queue = board.defaultQueue?.key?.trim().toUpperCase();
  if (queue) {
    return `${queue} / ${board.name}`;
  }
  return board.name;
}

/** Group boards by default queue for the two-step picker. */
export function groupBoardsByQueue(boards: readonly TrackerBoard[]): BoardQueueGroup[] {
  const map = new Map<string, BoardQueueGroup>();
  for (const board of boards) {
    const key = boardQueueKey(board);
    let group = map.get(key);
    if (!group) {
      group = { key, label: boardQueueLabel(board), boards: [] };
      map.set(key, group);
    }
    group.boards.push(board);
  }
  for (const group of map.values()) {
    group.boards.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === '__other__') {
      return 1;
    }
    if (b.key === '__other__') {
      return -1;
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
}

/** Back-compat aliases used by settings UI copied from Jira. */
export const groupBoardsByProject = groupBoardsByQueue;
export type BoardProjectGroup = BoardQueueGroup;
export const boardProjectKey = boardQueueKey;
export const boardProjectLabel = boardQueueLabel;
