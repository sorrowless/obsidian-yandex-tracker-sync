import type { TaskStatus } from '../sync/status';

export interface ParsedTaskNode {
  /** 0-based line index of the checklist item in the source note. */
  lineIndex: number;
  /** Inclusive last line index of this task block (descriptions + descendants). */
  endLineIndex: number;
  /** Leading whitespace before the list marker. */
  indent: string;
  /** List marker as written (`-`, `*`, `1.`). */
  listMarker: string;
  /** Character inside the brackets (` `, `x`, `X`, `/`, …). */
  checkboxChar: string;
  /**
   * Legacy done flag: true for x/X, false for space, null for other chars.
   * Prefer `status` for sync logic.
   */
  done: boolean | null;
  /**
   * Synced workflow status: todo `[ ]`, in_progress `[/]`, review `[?]`, done `[x]`/`[X]`.
   * `null` when the checkbox is outside the sync contract (e.g. `[-]`).
   */
  status: TaskStatus | null;
  /** Task title (link text when linked, otherwise body without date tokens). */
  title: string;
  /** Tracker issue key when the body is a browse link to this site. */
  issueKey: string | null;
  /** ISO UTC start time, or null when unset. */
  startDate: string | null;
  /** ISO UTC due time, or null when unset. From Tracker end/deadline; pushes to deadline. */
  dueDate: string | null;
  /** Dataview `[assignee:: …]` value, or null when unset. */
  assignee: string | null;
  /** Dataview `[timespent:: …]` seconds from Tracker `spent` (pull-only), or null when unset. */
  timeSpentSeconds: number | null;
  /** Indented non-checkbox bullets under this task (description). */
  descriptionLines: string[];
  /** Source line indices for descriptionLines (parallel array). */
  descriptionLineIndices: number[];
  /** Nested checklist children. */
  children: ParsedTaskNode[];
}

export interface ParseNoteOptions {
  /** Tracker frontend site, e.g. https://tracker.yandex.ru */
  trackerSiteBaseUrl: string;
}
