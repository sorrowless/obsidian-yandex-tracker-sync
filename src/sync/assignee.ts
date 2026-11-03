import { normalizeAssigneeValue } from '../note/assignee';
import type { TrackerUser } from '../tracker/types';

/** One Tracker user (seen on a board) mapped to a Dataview `[assignee:: …]` value. */
export interface AssigneeMapping {
  /** Stable Tracker user id (uid string). */
  trackerUserId: string;
  /** Display label in settings / dropdowns. */
  trackerDisplayName: string;
  /** Optional Tracker login; preferred when writing `assignee` back. */
  trackerLogin?: string;
  /** Obsidian Dataview value, e.g. `Аряпов` for `[assignee:: Аряпов]`. */
  obsidianValue: string;
}

/** Cached assignee option loaded from board issues for the settings dropdown. */
export interface KnownTrackerAssignee {
  id: string;
  displayName: string;
  login?: string;
}

/** Trim fields in place; keeps incomplete draft rows for the settings UI. */
export function prepareAssigneeMappingsForSave(mappings: AssigneeMapping[]): void {
  for (const mapping of mappings) {
    mapping.trackerUserId = String(mapping.trackerUserId ?? '').trim();
    mapping.trackerDisplayName = String(mapping.trackerDisplayName ?? '').trim();
    mapping.obsidianValue = String(mapping.obsidianValue ?? '').trim();
    const login = String(mapping.trackerLogin ?? '').trim();
    mapping.trackerLogin = login || undefined;
  }
}

/** Complete mappings only (both Tracker id and Obsidian value). Used by sync. */
export function normalizeAssigneeMappings(
  mappings: readonly AssigneeMapping[] | null | undefined,
): AssigneeMapping[] {
  if (!mappings?.length) {
    return [];
  }
  const byId = new Map<string, AssigneeMapping>();
  for (const raw of mappings) {
    const trackerUserId = String(raw?.trackerUserId ?? '').trim();
    const obsidianValue = normalizeAssigneeValue(raw?.obsidianValue) ?? '';
    if (!trackerUserId || !obsidianValue) {
      continue;
    }
    const trackerDisplayName =
      String(raw?.trackerDisplayName ?? '').trim() || trackerUserId;
    const trackerLogin = String(raw?.trackerLogin ?? '').trim() || undefined;
    byId.set(trackerUserId.toLowerCase(), {
      trackerUserId,
      trackerDisplayName,
      trackerLogin,
      obsidianValue,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.trackerDisplayName.localeCompare(b.trackerDisplayName, undefined, {
      sensitivity: 'base',
    }),
  );
}

/** Stable identity of a Tracker user: `id`, falling back to `login`. */
export function trackerAssigneeIdentity(user: TrackerUser | null | undefined): string | null {
  if (!user) {
    return null;
  }
  const id = String(user.id ?? '').trim();
  if (id) {
    return id;
  }
  const login = String(user.login ?? '').trim();
  return login || null;
}

export function trackerAssigneeDisplayName(user: TrackerUser | null | undefined): string {
  if (!user) {
    return '';
  }
  const display = String(user.display ?? '').trim();
  if (display) {
    return display;
  }
  return trackerAssigneeIdentity(user) ?? '';
}

/** Match by Tracker user id, or by login when the remote identity is a login. */
export function findMappingByTrackerId(
  mappings: readonly AssigneeMapping[],
  trackerUserId: string | null | undefined,
): AssigneeMapping | null {
  const id = String(trackerUserId ?? '').trim().toLowerCase();
  if (!id) {
    return null;
  }
  return (
    mappings.find(
      (mapping) =>
        mapping.trackerUserId.toLowerCase() === id ||
        (mapping.trackerLogin?.toLowerCase() ?? '') === id,
    ) ?? null
  );
}

export function findMappingByObsidianValue(
  mappings: readonly AssigneeMapping[],
  obsidianValue: string | null | undefined,
): AssigneeMapping | null {
  const value = normalizeAssigneeValue(obsidianValue);
  if (!value) {
    return null;
  }
  const wanted = value.toLowerCase();
  return (
    mappings.find((mapping) => mapping.obsidianValue.toLowerCase() === wanted) ?? null
  );
}

/**
 * Value for the Tracker `assignee` field on create/update.
 * Prefers login, falls back to the user id.
 */
export function toTrackerAssigneeValue(mapping: AssigneeMapping): string {
  const login = mapping.trackerLogin?.trim();
  return login || mapping.trackerUserId;
}

export type AssigneeReconcileDecision =
  | { action: 'none' }
  | { action: 'set-local'; obsidianValue: string; detail: string }
  | { action: 'set-remote'; mapping: AssigneeMapping; detail: string };

/**
 * Decide assignee sync for an open task (caller must skip when both sides are done).
 *
 * - Obsidian empty, Tracker mapped → set Obsidian
 * - Obsidian set (mapped), Tracker empty → set Tracker
 * - Both set and differ → Obsidian wins (set Tracker when local value is mapped)
 * - Unmapped side → no-op for that direction
 */
export function decideAssigneeReconcile(input: {
  localAssignee: string | null | undefined;
  remoteAssigneeId: string | null | undefined;
  mappings: readonly AssigneeMapping[];
}): AssigneeReconcileDecision {
  const mappings = normalizeAssigneeMappings(input.mappings);
  if (mappings.length === 0) {
    return { action: 'none' };
  }

  const localValue = normalizeAssigneeValue(input.localAssignee);
  const remoteMapping = findMappingByTrackerId(mappings, input.remoteAssigneeId);
  const localMapping = findMappingByObsidianValue(mappings, localValue);

  if (!localValue && remoteMapping) {
    return {
      action: 'set-local',
      obsidianValue: remoteMapping.obsidianValue,
      detail: `set [assignee:: ${remoteMapping.obsidianValue}] from Tracker (${remoteMapping.trackerDisplayName})`,
    };
  }

  if (localValue && !input.remoteAssigneeId) {
    if (!localMapping) {
      return { action: 'none' };
    }
    return {
      action: 'set-remote',
      mapping: localMapping,
      detail: `set Tracker assignee to ${localMapping.trackerDisplayName} from [assignee:: ${localValue}]`,
    };
  }

  if (localValue && input.remoteAssigneeId) {
    const remoteObsidian = remoteMapping?.obsidianValue ?? null;
    const same =
      remoteObsidian !== null &&
      remoteObsidian.toLowerCase() === localValue.toLowerCase();
    if (same) {
      return { action: 'none' };
    }
    // Differ — Obsidian wins when the local value is mapped.
    if (!localMapping) {
      return { action: 'none' };
    }
    return {
      action: 'set-remote',
      mapping: localMapping,
      detail: `Obsidian wins: set Tracker assignee to ${localMapping.trackerDisplayName} from [assignee:: ${localValue}]`,
    };
  }

  return { action: 'none' };
}

export function collectAssigneesFromIssues(
  issues: ReadonlyArray<{ assignee?: TrackerUser | null }>,
): KnownTrackerAssignee[] {
  const byId = new Map<string, KnownTrackerAssignee>();
  for (const issue of issues) {
    const user = issue.assignee;
    const id = trackerAssigneeIdentity(user);
    if (!id || !user) {
      continue;
    }
    const key = id.toLowerCase();
    if (byId.has(key)) {
      continue;
    }
    byId.set(key, {
      id,
      displayName: trackerAssigneeDisplayName(user),
      login: String(user.login ?? '').trim() || undefined,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
}
