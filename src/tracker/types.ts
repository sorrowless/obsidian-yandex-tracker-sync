export class TrackerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'TrackerApiError';
  }
}

export type OrgIdHeader = 'X-Org-ID' | 'X-Cloud-Org-ID';

export interface TrackerUser {
  self?: string;
  id: string;
  display?: string;
  login?: string;
  email?: string;
  passportUid?: number;
  cloudUid?: string;
  firstName?: string;
  lastName?: string;
}

export interface TrackerRef {
  self?: string;
  id?: string | number;
  key?: string;
  display?: string;
}

export interface TrackerStatusRef {
  self?: string;
  id?: string | number;
  key?: string;
  display?: string;
  /** Present on some issue payloads; otherwise resolved via listStatuses. */
  type?: 'new' | 'inProgress' | 'paused' | 'done' | 'cancelled' | string;
}

export interface TrackerStatus {
  self?: string;
  id: number | string;
  key: string;
  name?: string;
  display?: string;
  description?: string;
  type?: 'new' | 'inProgress' | 'paused' | 'done' | 'cancelled' | string;
}

export interface TrackerBoardColumnSummary {
  self?: string;
  id: string | number;
  display?: string;
  name?: string;
}

export interface TrackerBoardColumnStatus {
  self?: string;
  id?: string | number;
  key?: string;
  display?: string;
}

export interface TrackerBoardColumn {
  self?: string;
  id: string | number;
  name?: string;
  display?: string;
  statuses?: TrackerBoardColumnStatus[];
}

export interface TrackerBoard {
  self?: string;
  id: number;
  version?: number;
  name: string;
  columns?: TrackerBoardColumnSummary[];
  /**
   * Structured filter (field → value). Incompatible with `query` on the board
   * itself; when present we pass it as `filter` to `POST /issues/_search`.
   */
  filter?: Record<string, unknown>;
  /** Query-language filter string for issues shown on the board. */
  query?: string;
  orderBy?: string;
  orderAsc?: boolean;
  defaultQueue?: TrackerRef;
}

export interface TrackerTransition {
  self?: string;
  id: string;
  display?: string;
  to: TrackerStatusRef;
  screen?: TrackerRef;
}

export interface TrackerIssue {
  self?: string;
  id: string;
  key: string;
  version?: number;
  summary?: string;
  description?: string | null;
  status?: TrackerStatusRef;
  type?: TrackerRef;
  priority?: TrackerRef;
  queue?: TrackerRef;
  parent?: TrackerRef | null;
  assignee?: TrackerUser | null;
  tags?: string[];
  boards?: Array<{ id?: number }>;
  start?: string | null;
  end?: string | null;
  deadline?: string | null;
  spent?: number | string | null;
  createdAt?: string;
  updatedAt?: string;
  [field: string]: unknown;
}

export interface CreateIssueInput {
  queue: string;
  summary: string;
  description?: string;
  parentKey?: string | null;
  tags?: string[];
  start?: string | null;
  deadline?: string | null;
  /** Login or uid string understood by Tracker. */
  assignee?: string | null;
}

export interface UpdateIssueInput {
  summary?: string;
  description?: string;
  parentKey?: string | null;
  tags?: string[];
  start?: string | null;
  deadline?: string | null;
  /** Login/uid string, or `null` to clear. */
  assignee?: string | null;
}
