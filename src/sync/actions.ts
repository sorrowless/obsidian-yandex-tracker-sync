export type SyncActionKind =
  | 'create-remote'
  | 'create-local'
  | 'push'
  | 'pull'
  | 'conflict-push'
  | 'conflict-pull'
  | 'unchanged'
  | 'unresolved-missing-remote'
  | 'unresolved-missing-local'
  | 'recovered-pending'
  | 'duplicate-skip'
  | 'reconcile-labels'
  | 'reconcile-assignee'
  | 'reconcile-timespent'
  | 'derive-start';

export interface SyncActionDetail {
  kind: SyncActionKind;
  /** Human-readable task title. */
  title: string;
  issueKey?: string | null;
  /** Extra context shown in the report. */
  detail?: string;
}

export function emptyActions(): SyncActionDetail[] {
  return [];
}

export function formatActionLabel(kind: SyncActionKind, dryRun: boolean): string {
  const prefix = dryRun ? 'Would ' : '';
  switch (kind) {
    case 'create-remote':
      return `${prefix}create in Tracker`;
    case 'create-local':
      return `${prefix}import into Obsidian`;
    case 'push':
      return `${prefix}update Tracker from Obsidian`;
    case 'pull':
      return `${prefix}update Obsidian from Tracker`;
    case 'conflict-push':
      return `${prefix}resolve conflict → Obsidian wins (push)`;
    case 'conflict-pull':
      return `${prefix}resolve conflict → Tracker wins (pull)`;
    case 'unchanged':
      return 'Unchanged';
    case 'unresolved-missing-remote':
      return 'Unresolved — linked in note, missing in Tracker';
    case 'unresolved-missing-local':
      return 'Unresolved — known from ledger, missing in note';
    case 'recovered-pending':
      return `${prefix}relink pending Tracker issue`;
    case 'duplicate-skip':
      return 'Skipped duplicate link in note';
    case 'reconcile-labels':
      return `${prefix}align status labels with board column`;
    case 'reconcile-assignee':
      return `${prefix}sync assignee`;
    case 'reconcile-timespent':
      return `${prefix}sync time spent from Tracker`;
    case 'derive-start':
      return `${prefix}set start date from Tracker start`;
    default: {
      const _exhaustive: never = kind;
      return String(_exhaustive);
    }
  }
}

/** Ordered sections for the user-facing report. */
export const ACTION_REPORT_ORDER: SyncActionKind[] = [
  'create-remote',
  'create-local',
  'push',
  'pull',
  'conflict-push',
  'conflict-pull',
  'derive-start',
  'recovered-pending',
  'duplicate-skip',
  'reconcile-labels',
  'reconcile-assignee',
  'reconcile-timespent',
  'unresolved-missing-remote',
  'unresolved-missing-local',
];
