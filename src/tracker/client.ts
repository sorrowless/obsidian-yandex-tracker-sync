import type { HttpTransport } from './http';
import { createFetchTransport } from './http';
import {
  describeIssueSyncFilter,
  normalizeIssueSyncFilter,
  type IssueSyncFilter,
} from './issue-filter';
import {
  boardScopeQuery,
  columnStatusesClause,
  combineQueryParts,
  escapeQueryLiteral,
  isBlockedColumnName,
  pausedStatusTypeClause,
  queueScopeQuery,
  quoteQueryValue,
  type RecencyFilter,
} from './query';
import {
  TrackerApiError,
  type CreateIssueInput,
  type OrgIdHeader,
  type TrackerBoard,
  type TrackerBoardColumn,
  type TrackerIssue,
  type TrackerStatus,
  type TrackerTransition,
  type TrackerUser,
  type UpdateIssueInput,
} from './types';
import { apiV3Root, normalizeBaseUrl } from './urls';

export interface TrackerClientOptions {
  /** API host, e.g. https://api.tracker.yandex.net */
  apiBaseUrl: string;
  oauthToken: string;
  orgId: string;
  /** Which org header to send. */
  orgIdHeader: OrgIdHeader;
  transport?: HttpTransport;
}

export class TrackerClient {
  readonly apiBaseUrl: string;
  private readonly token: string;
  private readonly orgId: string;
  private readonly orgIdHeader: OrgIdHeader;
  private readonly transport: HttpTransport;

  constructor(options: TrackerClientOptions) {
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || 'https://api.tracker.yandex.net');
    if (!this.apiBaseUrl) {
      throw new Error('Tracker API base URL is required');
    }
    this.token = options.oauthToken.trim();
    if (!this.token) {
      throw new Error('Tracker OAuth token is required');
    }
    this.orgId = options.orgId.trim();
    if (!this.orgId) {
      throw new Error('Tracker organization ID is required');
    }
    this.orgIdHeader = options.orgIdHeader;
    this.transport = options.transport ?? createFetchTransport();
  }

  /**
   * Lightweight auth check — only `/v3/myself`.
   * Listing every board can take a long time (or hang on bad pagination), so
   * Test connection must not depend on `listBoards()`.
   */
  async testConnection(): Promise<{ displayName: string; boardCount: number }> {
    const me = await this.getMyself();
    return {
      displayName: me.display ?? me.login ?? me.id ?? 'ok',
      // Board count is filled by an optional follow-up; keep 0 here for speed.
      boardCount: 0,
    };
  }

  /** Auth check that also counts boards (may be slower). */
  async testConnectionWithBoards(): Promise<{ displayName: string; boardCount: number }> {
    const me = await this.getMyself();
    const boards = await this.listBoards();
    return {
      displayName: me.display ?? me.login ?? me.id ?? 'ok',
      boardCount: boards.length,
    };
  }

  async getMyself(): Promise<TrackerUser> {
    return this.requestJson<TrackerUser>('GET', `${apiV3Root(this.apiBaseUrl)}/myself`);
  }

  /**
   * List boards visible to the token.
   *
   * Tracker paginates list endpoints at 50 by default. Some tenants omit
   * `X-Total-Pages` and/or ignore `page`, which used to make us hammer the API
   * up to 100 times and freeze the Browse board button. We now:
   * - stop on empty / short page / total-pages header
   * - stop if a page repeats an id we already saw (broken pagination)
   * - hard-cap pages (default 5 ⇒ ≤250 boards, enough for the picker)
   */
  async listBoards(options?: { perPage?: number; maxPages?: number }): Promise<TrackerBoard[]> {
    const perPage = Math.min(Math.max(options?.perPage ?? 50, 1), 100);
    const maxPages = Math.min(Math.max(options?.maxPages ?? 5, 1), 20);
    const byId = new Map<number, TrackerBoard>();
    let page = 1;

    while (page <= maxPages) {
      const { data: batch, headers } = await this.requestJsonWithMeta<unknown>(
        'GET',
        `${apiV3Root(this.apiBaseUrl)}/boards?perPage=${perPage}&page=${page}`,
      );
      const values = normalizeBoardListPayload(batch);
      if (values.length === 0) {
        break;
      }

      let newOnPage = 0;
      for (const board of values) {
        const id = Number(board.id);
        if (!Number.isFinite(id) || id <= 0) {
          continue;
        }
        if (!byId.has(id)) {
          byId.set(id, board);
          newOnPage += 1;
        }
      }

      // Same page repeated (API ignored `page`) — stop instead of looping forever.
      if (newOnPage === 0) {
        break;
      }

      const totalPages = Number.parseInt(headers['x-total-pages'] ?? '', 10);
      if (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages) {
        break;
      }
      if (values.length < perPage) {
        break;
      }
      page += 1;
    }

    return [...byId.values()].sort((a, b) =>
      String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, {
        sensitivity: 'base',
      }),
    );
  }

  async getBoard(boardId: number): Promise<TrackerBoard> {
    return this.requestJson<TrackerBoard>(
      'GET',
      `${apiV3Root(this.apiBaseUrl)}/boards/${boardId}`,
    );
  }

  async getBoardColumn(boardId: number, columnId: string | number): Promise<TrackerBoardColumn> {
    return this.requestJson<TrackerBoardColumn>(
      'GET',
      `${apiV3Root(this.apiBaseUrl)}/boards/${boardId}/columns/${columnId}`,
    );
  }

  /**
   * Board columns with status keys expanded (GET board only returns id/display).
   */
  async getBoardColumnsWithStatuses(boardId: number): Promise<TrackerBoardColumn[]> {
    const board = await this.getBoard(boardId);
    const summaries = board.columns ?? [];
    const columns: TrackerBoardColumn[] = [];
    for (const summary of summaries) {
      try {
        const full = await this.getBoardColumn(boardId, summary.id);
        columns.push({
          ...full,
          name: full.name ?? full.display ?? summary.display ?? String(summary.id),
          display: full.display ?? summary.display,
        });
      } catch {
        columns.push({
          id: summary.id,
          name: summary.display ?? summary.name ?? String(summary.id),
          display: summary.display,
          statuses: [],
        });
      }
    }
    return columns;
  }

  async listStatuses(): Promise<TrackerStatus[]> {
    const result = await this.requestJson<TrackerStatus[]>(
      'GET',
      `${apiV3Root(this.apiBaseUrl)}/statuses`,
    );
    return Array.isArray(result) ? result : [];
  }

  /**
   * Search issues with Tracker query language and/or structured filter.
   * Paginated via `page` / `perPage`.
   */
  async searchIssues(
    query: string,
    maxTotal = 1000,
    structuredFilter?: Record<string, unknown> | null,
  ): Promise<TrackerIssue[]> {
    const results: TrackerIssue[] = [];
    let page = 1;
    const perPage = 50;
    const trimmed = query.trim();
    const hasFilter =
      structuredFilter !== null &&
      structuredFilter !== undefined &&
      Object.keys(structuredFilter).length > 0;
    while (results.length < maxTotal) {
      const qs = new URLSearchParams({
        perPage: String(Math.min(perPage, maxTotal - results.length)),
        page: String(page),
      });
      const body: Record<string, unknown> = {};
      if (trimmed) {
        body.query = trimmed;
      }
      if (hasFilter) {
        body.filter = structuredFilter;
      }
      if (!trimmed && !hasFilter) {
        // Empty search is invalid; return nothing rather than erroring.
        return results;
      }
      const batch = await this.requestJson<TrackerIssue[]>(
        'POST',
        `${apiV3Root(this.apiBaseUrl)}/issues/_search?${qs.toString()}`,
        body,
      );
      const values = Array.isArray(batch) ? batch : [];
      results.push(...values.map((issue) => this.normalizeIssue(issue)));
      if (values.length < perPage) {
        break;
      }
      page += 1;
      if (page > 200) {
        break;
      }
    }
    return results;
  }

  /**
   * Issues for a board mapping.
   *
   * Always **unions** successful strategies. Board `query`/`filter` alone often
   * omit Blocked / paused cards (and sprint-scoped queries omit backlog). We
   * therefore also search the default queue by column statuses and by
   * `"Status Type": paused`.
   *
   * Mapping tags/recency are always AND-combined via the query string.
   */
  async listBoardIssuesForSync(
    boardId: number,
    filter: IssueSyncFilter | readonly string[] = {},
    recency?: RecencyFilter | null,
  ): Promise<TrackerIssue[]> {
    const syncFilter = normalizeIssueSyncFilter(filter, recency);
    const board = await this.getBoard(boardId);

    let columns: TrackerBoardColumn[] = [];
    try {
      columns = await this.getBoardColumnsWithStatuses(boardId);
    } catch {
      // Column enrichment is best-effort; base strategies still run.
    }

    let pausedStatusKeys: string[] = [];
    try {
      const statuses = await this.listStatuses();
      pausedStatusKeys = statuses
        .filter((status) => String(status.type ?? '').toLowerCase() === 'paused')
        .flatMap((status) => {
          const keys: string[] = [];
          if (status.key) {
            keys.push(String(status.key));
          }
          if (status.display) {
            keys.push(String(status.display));
          }
          if (status.name) {
            keys.push(String(status.name));
          }
          return keys;
        });
    } catch {
      // Optional.
    }

    const attempts = buildBoardSearchAttempts(board, syncFilter, columns, pausedStatusKeys);
    const errors: string[] = [];
    const byKey = new Map<string, TrackerIssue>();
    let anySuccess = false;
    const maxTotal = 5000;

    for (const attempt of attempts) {
      try {
        const issues = await this.searchIssues(attempt.query, maxTotal, attempt.filter);
        anySuccess = true;
        for (const issue of issues) {
          byKey.set(issue.key.toUpperCase(), issue);
        }
      } catch (error) {
        errors.push(
          `${attempt.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (anySuccess) {
      return [...byKey.values()];
    }

    throw new TrackerApiError(
      `Failed to load issues for board ${boardId} with ${describeIssueSyncFilter(syncFilter)}. ${
        errors.join(' | ') || 'No search strategy succeeded.'
      }`,
      404,
      errors.join('\n'),
    );
  }

  /** Collect unique tags from issues currently on the board. */
  async listBoardTags(boardId: number): Promise<string[]> {
    const issues = await this.listBoardIssuesForSync(boardId, {});
    const collector = new Set<string>();
    for (const issue of issues) {
      for (const tag of issue.tags ?? []) {
        const trimmed = String(tag).trim();
        if (trimmed) {
          collector.add(trimmed);
        }
      }
    }
    return [...collector].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /** Assignees already present on board issues. */
  async listBoardAssignees(boardId: number): Promise<TrackerUser[]> {
    const issues = await this.listBoardIssuesForSync(boardId, {});
    const byId = new Map<string, TrackerUser>();
    for (const issue of issues) {
      const user = issue.assignee;
      if (!user) {
        continue;
      }
      const id = String(user.id ?? user.login ?? '').trim();
      if (!id) {
        continue;
      }
      if (!byId.has(id.toLowerCase())) {
        byId.set(id.toLowerCase(), user);
      }
    }
    return [...byId.values()].sort((a, b) => {
      const left = String(a.display ?? a.login ?? a.id ?? '');
      const right = String(b.display ?? b.login ?? b.id ?? '');
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    });
  }

  async getIssue(issueKey: string): Promise<TrackerIssue> {
    const key = issueKey.trim().toUpperCase();
    return this.normalizeIssue(
      await this.requestJson<TrackerIssue>(
        'GET',
        `${apiV3Root(this.apiBaseUrl)}/issues/${encodeURIComponent(key)}`,
      ),
    );
  }

  /**
   * Find one issue in a queue whose summary equals `summary` exactly.
   * Uses Tracker exact-phrase syntax `Summary: #"…"`.
   */
  async findIssueByExactSummary(
    queueKey: string,
    summary: string,
  ): Promise<TrackerIssue | null> {
    const queue = queueKey.trim();
    const title = summary.trim();
    if (!queue || !title) {
      return null;
    }
    const query = `Queue: ${quoteQueryValue(queue)} AND Summary: #"${escapeQueryLiteral(title)}"`;
    const issues = await this.searchIssues(query, 20);
    const exact = issues.find(
      (issue) => String(issue.summary ?? '').trim() === title,
    );
    return exact ?? null;
  }

  /**
   * Resolve issues by key. Prefers a single search query (works even when GET
   * /issues/{key} 404s for some org setups), then falls back to per-key GET.
   */
  async findIssuesByKeys(
    issueKeys: readonly string[],
  ): Promise<Map<string, TrackerIssue>> {
    const wanted = [
      ...new Set(
        issueKeys
          .map((key) => key.trim().toUpperCase())
          .filter((key) => key.length > 0),
      ),
    ];
    const found = new Map<string, TrackerIssue>();
    if (wanted.length === 0) {
      return found;
    }

    const chunkSize = 40;
    for (let offset = 0; offset < wanted.length; offset += chunkSize) {
      const chunk = wanted.slice(offset, offset + chunkSize);
      const query = chunk.map((key) => `Key: ${key}`).join(' OR ');
      try {
        const issues = await this.searchIssues(query, chunk.length + 20);
        for (const issue of issues) {
          const key = issue.key.toUpperCase();
          if (chunk.includes(key)) {
            found.set(key, issue);
          }
        }
      } catch {
        // Fall through to other strategies for this chunk.
      }

      for (const key of chunk) {
        if (found.has(key)) {
          continue;
        }
        // Structured filter fallback (some orgs accept key in filter body).
        try {
          const filtered = await this.searchIssues('', 5, { key });
          const match = filtered.find((issue) => issue.key.toUpperCase() === key);
          if (match) {
            found.set(key, match);
            continue;
          }
        } catch {
          // continue to GET
        }
        try {
          found.set(key, await this.getIssue(key));
        } catch {
          // Leave missing; caller decides unresolved vs error.
        }
      }
    }

    return found;
  }

  async createIssue(input: CreateIssueInput): Promise<TrackerIssue> {
    const body: Record<string, unknown> = {
      queue: input.queue,
      summary: input.summary,
    };
    if (input.description !== undefined) {
      body.description = input.description;
    }
    if (input.parentKey) {
      body.parent = input.parentKey;
    }
    if (input.tags && input.tags.length > 0) {
      body.tags = [...input.tags];
    }
    if (input.start !== undefined) {
      body.start = input.start;
    }
    if (input.deadline !== undefined) {
      body.deadline = input.deadline;
    }
    if (input.assignee) {
      body.assignee = input.assignee;
    }
    return this.normalizeIssue(
      await this.requestJson<TrackerIssue>(
        'POST',
        `${apiV3Root(this.apiBaseUrl)}/issues`,
        body,
      ),
    );
  }

  async updateIssue(issueKey: string, input: UpdateIssueInput): Promise<TrackerIssue> {
    const body: Record<string, unknown> = {};
    if (input.summary !== undefined) {
      body.summary = input.summary;
    }
    if (input.description !== undefined) {
      body.description = input.description;
    }
    if (input.parentKey !== undefined) {
      body.parent = input.parentKey;
    }
    if (input.tags !== undefined) {
      body.tags = [...input.tags];
    }
    if (input.start !== undefined) {
      body.start = input.start;
    }
    if (input.deadline !== undefined) {
      body.deadline = input.deadline;
    }
    if (input.end !== undefined) {
      body.end = input.end;
    }
    if (input.assignee !== undefined) {
      body.assignee = input.assignee;
    }
    return this.normalizeIssue(
      await this.requestJson<TrackerIssue>(
        'PATCH',
        `${apiV3Root(this.apiBaseUrl)}/issues/${encodeURIComponent(issueKey)}`,
        body,
      ),
    );
  }

  async listTransitions(issueKey: string): Promise<TrackerTransition[]> {
    const result = await this.requestJson<TrackerTransition[]>(
      'GET',
      `${apiV3Root(this.apiBaseUrl)}/issues/${encodeURIComponent(issueKey)}/transitions`,
    );
    return Array.isArray(result) ? result : [];
  }

  /**
   * Transition issue toward a target status key/id in one hop.
   * Optionally passes `resolution` for done-family transitions.
   */
  async transitionToStatus(
    issueKey: string,
    targetStatusKeyOrId: string,
    options?: { resolution?: string },
  ): Promise<TrackerTransition[]> {
    const target = targetStatusKeyOrId.trim().toLowerCase();
    const transitions = await this.listTransitions(issueKey);
    const match =
      transitions.find((t) => transitionDestinationMatches(t, target)) ?? null;

    if (!match) {
      throw new TrackerApiError(
        `No transition to status "${targetStatusKeyOrId}" for ${issueKey}. Available: ${
          transitions.map((t) => t.to?.key ?? t.id).join(', ') || '(none)'
        }`,
        400,
      );
    }

    return this.executeTransition(issueKey, match.id, options?.resolution);
  }

  /**
   * Walk workflow transitions until the issue lands in one of `targetStatusIds`
   * (keys, ids, or display names). Takes intermediate hops when no direct edge
   * exists (e.g. Open → In Progress → Closed). Returns true when a transition ran.
   */
  async transitionTowardStatuses(
    issueKey: string,
    targetStatusIds: readonly string[],
    options?: { resolution?: string; maxHops?: number },
  ): Promise<boolean> {
    const targets = new Set(
      targetStatusIds.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0),
    );
    if (targets.size === 0) {
      throw new TrackerApiError(`No target statuses for ${issueKey}`, 400);
    }

    const maxHops = options?.maxHops ?? 8;
    const visitedTransitionIds = new Set<string>();
    let transitions = await this.listTransitions(issueKey);

    for (let hop = 0; hop < maxHops; hop += 1) {
      if (transitions.length === 0) {
        transitions = await this.listTransitions(issueKey);
      }
      if (transitions.length === 0) {
        break;
      }

      const direct = pickBestTransition(
        transitions.filter((t) =>
          transitionDestinations(t).some((dest) => targets.has(dest)),
        ),
        targets,
      );
      if (direct) {
        await this.executeTransition(issueKey, direct.id, options?.resolution);
        return true;
      }

      const candidates = transitions.filter((t) => !visitedTransitionIds.has(String(t.id)));
      if (candidates.length === 0) {
        break;
      }

      const pick = pickBestTransition(candidates, targets) ?? candidates[0]!;
      visitedTransitionIds.add(String(pick.id));
      // Intermediate hops never send resolution; response lists next transitions.
      transitions = await this.executeTransition(issueKey, pick.id, undefined);
    }

    const issue = await this.getIssue(issueKey);
    const current = [
      issue.status?.key,
      issue.status?.id,
      issue.status?.display,
    ]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map((value) => String(value).toLowerCase());
    if (current.some((value) => targets.has(value))) {
      return true;
    }

    throw new TrackerApiError(
      `Could not reach target status for ${issueKey} within ${maxHops} hops. Targets: ${[
        ...targets,
      ].join(', ')}. Last available: ${
        transitions.map((t) => t.to?.key ?? t.id).join(', ') || '(none)'
      }`,
      400,
    );
  }

  /**
   * Execute a transition. When `resolution` is set, retries without it (and with
   * `{ key }` form) if the workflow rejects the first payload.
   */
  private async executeTransition(
    issueKey: string,
    transitionId: string,
    resolution?: string,
  ): Promise<TrackerTransition[]> {
    const post = async (body: Record<string, unknown>): Promise<TrackerTransition[]> => {
      const result = await this.requestJson<TrackerTransition[]>(
        'POST',
        `${apiV3Root(this.apiBaseUrl)}/issues/${encodeURIComponent(issueKey)}/transitions/${encodeURIComponent(transitionId)}/_execute`,
        body,
      );
      return Array.isArray(result) ? result : [];
    };

    if (!resolution) {
      return post({});
    }

    try {
      return await post({ resolution });
    } catch (stringErr) {
      try {
        return await post({ resolution: { key: resolution } });
      } catch {
        try {
          return await post({});
        } catch {
          throw stringErr;
        }
      }
    }
  }

  private normalizeIssue(issue: TrackerIssue): TrackerIssue {
    return {
      ...issue,
      key: String(issue.key ?? '').toUpperCase(),
      summary: issue.summary ?? '',
      description: issue.description ?? '',
      tags: Array.isArray(issue.tags) ? issue.tags.map(String) : [],
    };
  }

  private async requestJson<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const { data } = await this.requestJsonWithMeta<T>(method, url, body);
    return data;
  }

  private async requestJsonWithMeta<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ data: T; headers: Record<string, string>; status: number }> {
    // Keep headers minimal — same set as the working CubieProg Tracker plugin.
    // Do not set User-Agent/Host: Obsidian's requestUrl/Electron can mishandle them.
    const headers: Record<string, string> = {
      Authorization: `OAuth ${this.token}`,
      [this.orgIdHeader]: this.orgId,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await this.transport({
      url,
      method,
      headers,
      body: payload,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new TrackerApiError(
        `Tracker API ${method} ${url} failed (${response.status}): ${response.text.slice(0, 500)}`,
        response.status,
        response.text,
      );
    }
    if (!response.text || response.text.trim() === '') {
      return { data: undefined as T, headers: response.headers, status: response.status };
    }
    try {
      return {
        data: JSON.parse(response.text) as T,
        headers: response.headers,
        status: response.status,
      };
    } catch {
      throw new TrackerApiError(
        `Tracker API returned non-JSON (${response.status})`,
        response.status,
        response.text,
      );
    }
  }
}

function transitionDestinations(transition: TrackerTransition): string[] {
  const dest: string[] = [];
  if (transition.to?.key) {
    dest.push(String(transition.to.key).toLowerCase());
  }
  if (transition.to?.id !== undefined && transition.to.id !== null && transition.to.id !== '') {
    dest.push(String(transition.to.id).toLowerCase());
  }
  if (transition.to?.display) {
    dest.push(String(transition.to.display).toLowerCase());
  }
  return dest;
}

function transitionDestinationMatches(
  transition: TrackerTransition,
  target: string,
): boolean {
  return transitionDestinations(transition).includes(target);
}

function transitionLabel(transition: TrackerTransition): string {
  return String(transition.to?.display ?? transition.to?.key ?? '')
    .trim()
    .toLowerCase();
}

function isProgressLikeTransition(transition: TrackerTransition): boolean {
  const label = transitionLabel(transition);
  return (
    label === 'in progress' ||
    label === 'in-progress' ||
    label === 'inprogress' ||
    label.includes('progress') ||
    label === 'в работе' ||
    /(^|\s)в работе(\s|$)/i.test(label) ||
    label.includes('работ')
  );
}

function isDoneLikeTransition(transition: TrackerTransition): boolean {
  const label = transitionLabel(transition);
  const type = String(transition.to?.type ?? '').toLowerCase();
  return (
    type === 'done' ||
    type === 'cancelled' ||
    type === 'canceled' ||
    /(done|closed|resolved|complete|finish|готов|закрыт|завершен|выполнен|решен|сделан)/i.test(
      label,
    )
  );
}

function isTodoLikeTransition(transition: TrackerTransition): boolean {
  const label = transitionLabel(transition);
  const type = String(transition.to?.type ?? '').toLowerCase();
  return type === 'new' || /^(open|to ?do|backlog|открыт|бэклог|новый)/i.test(label);
}

/** Rank transitions: hit target, else done-like, else progress, avoid todo/cancel. */
function scoreTransition(transition: TrackerTransition, targets: Set<string>): number {
  const dests = transitionDestinations(transition);
  if (dests.some((dest) => targets.has(dest))) {
    return 1000;
  }
  if (isDoneLikeTransition(transition)) {
    return 500;
  }
  if (isProgressLikeTransition(transition)) {
    return 100;
  }
  const label = transitionLabel(transition);
  if (/(review|ревью|проверк|block|блок)/i.test(label)) {
    return 40;
  }
  if (isTodoLikeTransition(transition)) {
    return -20;
  }
  if (/(cancel|trash|отмен)/i.test(label)) {
    return -100;
  }
  return 0;
}

function pickBestTransition(
  transitions: readonly TrackerTransition[],
  targets: Set<string>,
): TrackerTransition | null {
  if (transitions.length === 0) {
    return null;
  }
  let best = transitions[0]!;
  let bestScore = scoreTransition(best, targets);
  for (let i = 1; i < transitions.length; i += 1) {
    const candidate = transitions[i]!;
    const score = scoreTransition(candidate, targets);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Accept a bare array or a `{ values|boards: [...] }` wrapper. */
export function normalizeBoardListPayload(payload: unknown): TrackerBoard[] {
  if (Array.isArray(payload)) {
    return payload as TrackerBoard[];
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['values', 'boards', 'items'] as const) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        return candidate as TrackerBoard[];
      }
    }
  }
  return [];
}

export interface BoardSearchAttempt {
  label: string;
  query: string;
  filter?: Record<string, unknown> | null;
}

function statusKeysFromColumn(column: TrackerBoardColumn): string[] {
  const ids: string[] = [];
  for (const status of column.statuses ?? []) {
    if (status.key) {
      ids.push(String(status.key));
    }
    if (status.display) {
      ids.push(String(status.display));
    }
  }
  return ids;
}

/**
 * Build ordered search strategies for a board.
 * Never emits the invalid `Board: <id>` clause.
 * Callers should **union** all successful attempts (Blocked/paused often miss
 * sprint-only board.query results).
 */
export function buildBoardSearchAttempts(
  board: TrackerBoard,
  syncFilter: IssueSyncFilter,
  columns: readonly TrackerBoardColumn[] = [],
  pausedStatusKeys: readonly string[] = [],
): BoardSearchAttempt[] {
  const tags = syncFilter.tags ?? syncFilter.labels ?? [];
  const recency = syncFilter.recency ?? null;
  const extras = combineQueryParts('', tags, recency);
  const attempts: BoardSearchAttempt[] = [];

  const boardQuery = typeof board.query === 'string' ? board.query.trim() : '';
  if (boardQuery) {
    attempts.push({
      label: 'board.query',
      query: combineQueryParts(boardQuery, tags, recency),
    });
  }

  const structured =
    board.filter && typeof board.filter === 'object' && !Array.isArray(board.filter)
      ? board.filter
      : null;
  if (structured && Object.keys(structured).length > 0) {
    attempts.push({
      label: 'board.filter',
      query: extras,
      filter: structured,
    });
  }

  attempts.push({
    label: 'Sprints By Board',
    query: combineQueryParts(boardScopeQuery(board.id), tags, recency),
  });

  const queueKey =
    String(syncFilter.queueKey ?? '').trim() ||
    board.defaultQueue?.key?.trim() ||
    '';
  const queueScope = queueKey ? queueScopeQuery(queueKey) : '';
  const scopePrefix = queueScope || boardScopeQuery(board.id);

  if (queueScope) {
    attempts.push({
      label: 'defaultQueue',
      query: combineQueryParts(queueScope, tags, recency),
    });
  }

  // Blocked / Need Info / other paused-type statuses — several strategies because
  // Status Type / mixed Status: clauses are flaky across orgs.
  attempts.push({
    label: 'paused Status Type',
    query: combineQueryParts(
      `${scopePrefix} AND ${pausedStatusTypeClause()}`,
      tags,
      recency,
    ),
  });

  const pausedClause = columnStatusesClause(pausedStatusKeys);
  if (pausedClause) {
    attempts.push({
      label: 'paused status keys',
      query: combineQueryParts(`${scopePrefix} AND ${pausedClause}`, tags, recency),
    });
  }

  for (const column of columns) {
    const columnName = String(column.name ?? column.display ?? '');
    if (!isBlockedColumnName(columnName)) {
      continue;
    }
    const blockedClause = columnStatusesClause(statusKeysFromColumn(column));
    if (!blockedClause) {
      // Fall back to the column title as a Status name.
      const byName = columnStatusesClause([columnName]);
      if (!byName) {
        continue;
      }
      attempts.push({
        label: `blocked column "${columnName}" by name`,
        query: combineQueryParts(`${scopePrefix} AND ${byName}`, tags, recency),
      });
      continue;
    }
    attempts.push({
      label: `blocked column "${columnName}"`,
      query: combineQueryParts(`${scopePrefix} AND ${blockedClause}`, tags, recency),
    });
    if (boardQuery) {
      attempts.push({
        label: `board.query + blocked column "${columnName}"`,
        query: combineQueryParts(`(${boardQuery}) AND ${blockedClause}`, tags, recency),
      });
    }
  }

  const allColumnKeys = columns.flatMap((column) => statusKeysFromColumn(column));
  const statusClause = columnStatusesClause(allColumnKeys);
  if (statusClause) {
    attempts.push({
      label: 'scope + board column statuses',
      query: combineQueryParts(`${scopePrefix} AND ${statusClause}`, tags, recency),
    });
  }

  return attempts;
}
