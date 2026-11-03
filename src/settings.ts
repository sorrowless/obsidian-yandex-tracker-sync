import {
  isRecencyField,
  isRecencyUnit,
  type RecencyField,
  type RecencyUnit,
} from './tracker/query';
import {
  normalizeAssigneeMappings,
  type AssigneeMapping,
  type KnownTrackerAssignee,
} from './sync/assignee';
import { normalizeMappingLabels } from './sync/label-filter';

export type { AssigneeMapping, KnownTrackerAssignee };

export type ConflictPolicy = 'prefer-obsidian' | 'prefer-tracker';
export type SyncIntervalUnit = 'minutes' | 'hours';
export type OrgIdHeaderMode = 'org' | 'cloud-org';
export type { RecencyField, RecencyUnit };
export { isRecencyField, isRecencyUnit };

export interface NoteBoardMapping {
  notePath: string;
  boardId: number;
  /**
   * Optional display name from the last Browse pick (e.g. `DOC / Team board`).
   * Not used by sync; cleared when the board id is typed manually.
   */
  boardName?: string;
  /**
   * Optional Tracker tag filter for this board.
   * Empty = sync all board issues. Non-empty = sync issues that have **any**
   * of these tags (OR). Status tags (to-do / in-progress / …) are separate.
   */
  labels: string[];
  /**
   * Optional queue key for creating new issues. Empty = board defaultQueue.
   */
  queueKey: string;
  /**
   * Optional recency window. `0` / unset = no limit.
   * Combined in query as `Updated|Created: >today()-Nd|-NM`.
   */
  recencyValue: number;
  recencyUnit: RecencyUnit;
  recencyField: RecencyField;
}

export interface PluginSettings {
  /** API host, default https://api.tracker.yandex.net */
  trackerApiBaseUrl: string;
  /** Frontend site for note links, default https://tracker.yandex.ru */
  trackerSiteBaseUrl: string;
  orgIdHeaderMode: OrgIdHeaderMode;
  orgId: string;
  oauthToken: string;
  /**
   * Resolution key passed when transitioning into a done-family status.
   * Default `fixed`. Empty = omit resolution from the transition body.
   */
  doneResolution: string;
  /**
   * Tracker assignee ↔ Obsidian Dataview `[assignee:: value]` mappings.
   */
  assigneeMappings: AssigneeMapping[];
  /** Cached assignees seen on mapped boards (for settings dropdowns). */
  knownAssignees: KnownTrackerAssignee[];
  mappings: NoteBoardMapping[];
  conflictPolicy: ConflictPolicy;
  syncOnStartup: boolean;
  syncIntervalEnabled: boolean;
  syncIntervalValue: number;
  syncIntervalUnit: SyncIntervalUnit;
  syncOnFileChange: boolean;
  /** When true, Sync now previews actions without writing notes or Tracker. */
  dryRunDefault: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  trackerApiBaseUrl: 'https://api.tracker.yandex.net',
  trackerSiteBaseUrl: 'https://tracker.yandex.ru',
  orgIdHeaderMode: 'org',
  orgId: '',
  oauthToken: '',
  doneResolution: 'fixed',
  assigneeMappings: [],
  knownAssignees: [],
  mappings: [],
  conflictPolicy: 'prefer-obsidian',
  syncOnStartup: false,
  syncIntervalEnabled: false,
  syncIntervalValue: 15,
  syncIntervalUnit: 'minutes',
  syncOnFileChange: false,
  dryRunDefault: false,
};

/** Minimum allowed interval in minutes (architecture: at least 1 minute). */
export const MIN_SYNC_INTERVAL_MINUTES = 1;

export function normalizeSyncIntervalValue(value: number): number {
  if (!Number.isFinite(value) || value < MIN_SYNC_INTERVAL_MINUTES) {
    return MIN_SYNC_INTERVAL_MINUTES;
  }
  return Math.floor(value);
}

export function syncIntervalToMilliseconds(
  value: number,
  unit: SyncIntervalUnit,
): number {
  const normalized = normalizeSyncIntervalValue(value);
  const minutes = unit === 'hours' ? normalized * 60 : normalized;
  return minutes * 60 * 1000;
}

export function createEmptyMapping(): NoteBoardMapping {
  return {
    notePath: '',
    boardId: 0,
    labels: [],
    queueKey: '',
    recencyValue: 0,
    recencyUnit: 'days',
    recencyField: 'updated',
  };
}

/** Normalize recency value: 0 disables the filter; negatives clamp to 0. */
export function normalizeRecencyValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

/** Normalize a vault-relative note path from settings. Spaces in names are kept. */
export function normalizeMappingPath(path: string): string {
  // NFC avoids macOS NFD filename mismatches with Cyrillic typed in settings.
  return path.trim().replace(/^\/+/, '').normalize('NFC');
}

export function isMappingComplete(mapping: NoteBoardMapping): boolean {
  return normalizeMappingPath(mapping.notePath).length > 0 && mapping.boardId > 0;
}

/** True when the row is still the blank draft created by “Add mapping”. */
export function isMappingBlank(mapping: NoteBoardMapping): boolean {
  return normalizeMappingPath(mapping.notePath).length === 0 && !(mapping.boardId > 0);
}

/**
 * Normalize mapping fields in place.
 * Important: do not replace mapping objects or the mappings array — the settings
 * tab keeps closures/indexes into these objects across keystrokes.
 */
export function prepareMappingsForSave(mappings: NoteBoardMapping[]): void {
  for (const mapping of mappings) {
    mapping.notePath = normalizeMappingPath(mapping.notePath);
    if (!Number.isFinite(mapping.boardId) || mapping.boardId < 0) {
      mapping.boardId = 0;
    } else {
      mapping.boardId = Math.floor(mapping.boardId);
    }
    mapping.labels = normalizeMappingLabels(mapping.labels);
    mapping.queueKey = String(mapping.queueKey ?? '').trim().toUpperCase();
    mapping.recencyValue = normalizeRecencyValue(mapping.recencyValue);
    mapping.recencyUnit = isRecencyUnit(mapping.recencyUnit) ? mapping.recencyUnit : 'days';
    mapping.recencyField = isRecencyField(mapping.recencyField) ? mapping.recencyField : 'updated';
  }
}

/** Build the optional recency filter object for the Tracker client (null when disabled). */
export function mappingRecencyFilter(mapping: {
  recencyValue?: number;
  recencyUnit?: RecencyUnit | string;
  recencyField?: RecencyField | string;
}): { field: RecencyField; value: number; unit: RecencyUnit } | null {
  const value = normalizeRecencyValue(mapping.recencyValue ?? 0);
  if (value <= 0) {
    return null;
  }
  return {
    field: isRecencyField(mapping.recencyField) ? mapping.recencyField : 'updated',
    value,
    unit: isRecencyUnit(mapping.recencyUnit) ? mapping.recencyUnit : 'days',
  };
}

export function isOrgIdHeaderMode(value: unknown): value is OrgIdHeaderMode {
  return value === 'org' || value === 'cloud-org';
}

export function orgIdHeaderName(mode: OrgIdHeaderMode): 'X-Org-ID' | 'X-Cloud-Org-ID' {
  return mode === 'cloud-org' ? 'X-Cloud-Org-ID' : 'X-Org-ID';
}

/** Re-export for callers that still import normalizeAssigneeMappings from settings. */
export { normalizeAssigneeMappings };
