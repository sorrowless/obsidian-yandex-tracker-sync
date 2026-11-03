import { htmlToPlainText } from './html-to-text';
import {
  isTaskStatus,
  statusFromDoneFlag,
  type TaskStatus,
} from './status';

export interface ContentSnapshot {
  title: string;
  description: string;
  status: TaskStatus;
  /** Exact Tracker status key/id — detects column moves even when coarse checkbox is unchanged. */
  trackerStatusId: string;
  trackerStatusName: string;
  parentIssueKey: string | null;
  startDate: string | null;
  dueDate: string | null;
}

export interface LedgerEntry {
  issueKey: string;
  mappingKey: string;
  title: string;
  description: string;
  status: TaskStatus;
  trackerStatusId: string;
  trackerStatusName: string;
  parentIssueKey: string | null;
  startDate: string | null;
  dueDate: string | null;
  contentHash: string;
  trackerUpdated: string;
  lastSyncedAt: string;
  unresolved?: boolean;
}

export interface LedgerStore {
  entries: Record<string, LedgerEntry>;
}

/** Remembers Tracker creates that were not yet written into the note. */
export interface PendingLink {
  mappingKey: string;
  issueKey: string;
  title: string;
  description: string;
  status: TaskStatus;
  parentIssueKey: string | null;
  trackerUpdated: string;
}

export function emptyLedger(): LedgerStore {
  return { entries: {} };
}

export function cloneLedger(ledger: LedgerStore): LedgerStore {
  const entries: Record<string, LedgerEntry> = {};
  for (const [key, entry] of Object.entries(ledger.entries)) {
    entries[key] = { ...entry };
  }
  return { entries };
}

export function commitMappingLedger(
  target: LedgerStore,
  source: LedgerStore,
  mappingKeyValue: string,
): void {
  const prefix = `${mappingKeyValue}::`;
  for (const key of Object.keys(target.entries)) {
    if (key.startsWith(prefix)) {
      delete target.entries[key];
    }
  }
  for (const [key, entry] of Object.entries(source.entries)) {
    if (key.startsWith(prefix)) {
      target.entries[key] = { ...entry };
    }
  }
}

/**
 * Stable ledger scope for a mapping.
 * Empty tag filter keeps the legacy `notePath::boardId` key (back-compat).
 * With filters: `notePath::boardId::tag1+tag2` (tags already normalized/sorted).
 */
export function mappingKey(
  notePath: string,
  boardId: number,
  labels: readonly string[] = [],
): string {
  const base = `${notePath}::${boardId}`;
  if (!labels.length) {
    return base;
  }
  return `${base}::${labels.join('+')}`;
}

export function ledgerEntryKey(mappingKeyValue: string, issueKey: string): string {
  return `${mappingKeyValue}::${issueKey.toUpperCase()}`;
}

export function descriptionFromLines(lines: string[]): string {
  return lines.join('\n');
}

export function descriptionToLines(description: string): string[] {
  const plain = htmlToPlainText(description ?? '');
  if (!plain) {
    return [];
  }
  return plain.split('\n').filter((line) => line.length > 0);
}

export function normalizeDescription(description: string): string {
  return descriptionFromLines(descriptionToLines(description));
}

export function contentSnapshot(input: {
  title: string;
  description: string;
  status: TaskStatus;
  trackerStatusId: string;
  trackerStatusName: string;
  parentIssueKey: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}): ContentSnapshot {
  return {
    title: input.title,
    description: input.description,
    status: input.status,
    trackerStatusId: input.trackerStatusId,
    trackerStatusName: input.trackerStatusName,
    parentIssueKey: input.parentIssueKey,
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
  };
}

export function contentHash(snapshot: ContentSnapshot): string {
  const payload = [
    snapshot.title,
    snapshot.description,
    snapshot.status,
    snapshot.trackerStatusId,
    snapshot.trackerStatusName,
    snapshot.parentIssueKey === null ? '' : snapshot.parentIssueKey,
    snapshot.startDate ?? '',
    snapshot.dueDate ?? '',
  ].join('\0');
  return fnv1aHex(payload);
}

export function snapshotFromLedger(entry: LedgerEntry): ContentSnapshot {
  return {
    title: entry.title,
    description: entry.description,
    status: resolveEntryStatus(entry),
    trackerStatusId: entry.trackerStatusId ?? '',
    trackerStatusName: entry.trackerStatusName ?? '',
    parentIssueKey: entry.parentIssueKey,
    startDate: entry.startDate ?? null,
    dueDate: entry.dueDate ?? null,
  };
}

export function makeLedgerEntry(input: {
  issueKey: string;
  mappingKey: string;
  title: string;
  description: string;
  status: TaskStatus;
  trackerStatusId: string;
  trackerStatusName: string;
  parentIssueKey: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  trackerUpdated: string;
  lastSyncedAt?: string;
  unresolved?: boolean;
}): LedgerEntry {
  const snapshot = contentSnapshot(input);
  return {
    issueKey: input.issueKey.toUpperCase(),
    mappingKey: input.mappingKey,
    title: snapshot.title,
    description: snapshot.description,
    status: snapshot.status,
    trackerStatusId: snapshot.trackerStatusId,
    trackerStatusName: snapshot.trackerStatusName,
    parentIssueKey: snapshot.parentIssueKey,
    startDate: snapshot.startDate,
    dueDate: snapshot.dueDate,
    contentHash: contentHash(snapshot),
    trackerUpdated: input.trackerUpdated,
    lastSyncedAt: input.lastSyncedAt ?? new Date().toISOString(),
    unresolved: input.unresolved,
  };
}

export function normalizeLedgerStore(raw: LedgerStore | undefined): LedgerStore {
  if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') {
    return emptyLedger();
  }
  const entries: Record<string, LedgerEntry> = {};
  for (const [key, value] of Object.entries(raw.entries)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const entry = value as LedgerEntry & { done?: boolean };
    entries[key] = makeLedgerEntry({
      issueKey: String(entry.issueKey ?? ''),
      mappingKey: String(entry.mappingKey ?? ''),
      title: String(entry.title ?? ''),
      description: String(entry.description ?? ''),
      status: resolveEntryStatus(entry),
      trackerStatusId: String(entry.trackerStatusId ?? ''),
      trackerStatusName: String(entry.trackerStatusName ?? ''),
      parentIssueKey:
        entry.parentIssueKey === null || entry.parentIssueKey === undefined
          ? null
          : String(entry.parentIssueKey).toUpperCase(),
      startDate: entry.startDate ?? null,
      dueDate: entry.dueDate ?? null,
      trackerUpdated: String(entry.trackerUpdated ?? ''),
      lastSyncedAt: String(entry.lastSyncedAt ?? new Date().toISOString()),
      unresolved: entry.unresolved,
    });
  }
  return { entries };
}

function resolveEntryStatus(entry: {
  status?: unknown;
  done?: boolean;
}): TaskStatus {
  if (isTaskStatus(entry.status)) {
    return entry.status;
  }
  return statusFromDoneFlag(Boolean(entry.done));
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
