import { describe, expect, it, vi } from 'vitest';
import type { TrackerClient } from '../tracker/client';
import type { CreateIssueInput, TrackerIssue, UpdateIssueInput } from '../tracker/types';
import type { ConflictPolicy } from '../settings';
import {
  emptyLedger,
  ledgerEntryKey,
  makeLedgerEntry,
  mappingKey,
  type LedgerStore,
  type PendingLink,
} from './ledger';
import { syncAllMappings } from './engine';

const SITE_URL = 'https://tracker.example';
const NOTE_PATH = 'Tasks/Test.md';
const BOARD_ID = 42;

const COLUMNS = [
  { id: 1, name: 'To Do', statuses: [{ id: '1', key: 'open', display: 'Open' }] },
  { id: 2, name: 'In Progress', statuses: [{ id: '2', key: 'inProgress', display: 'In Progress' }] },
  { id: 3, name: 'Review', statuses: [{ id: '3', key: 'review', display: 'Review' }] },
  { id: 4, name: 'Done', statuses: [{ id: '4', key: 'closed', display: 'Closed' }] },
];

const STATUSES = [
  { id: '1', key: 'open', display: 'Open', type: 'new' },
  { id: '2', key: 'inProgress', display: 'In Progress', type: 'inProgress' },
  { id: '3', key: 'review', display: 'Review', type: 'inProgress' },
  { id: '4', key: 'closed', display: 'Closed', type: 'done' },
];

function link(key: string, title: string, box = ' '): string {
  return `- [${box}] [${title}](${SITE_URL}/${key})`;
}

function issueRow(
  key: string,
  summary: string,
  overrides: Partial<TrackerIssue> = {},
): TrackerIssue {
  return {
    id: `id-${key}`,
    key: key.toUpperCase(),
    summary,
    description: '',
    status: { id: '1', key: 'open', display: 'Open' },
    queue: { key: 'PROJ' },
    tags: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface MockClientBundle {
  client: TrackerClient;
  issues: Map<string, TrackerIssue>;
  createIssue: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  transitionToStatus: ReturnType<typeof vi.fn>;
  transitionTowardStatuses: ReturnType<typeof vi.fn>;
  getIssue: ReturnType<typeof vi.fn>;
  findIssuesByKeys: ReturnType<typeof vi.fn>;
}

function createMockClient(initial: TrackerIssue[] = []): MockClientBundle {
  const issues = new Map<string, TrackerIssue>();
  for (const row of initial) {
    issues.set(row.key.toUpperCase(), structuredClone(row));
  }
  let nextId = 100;

  const getBoard = vi.fn(async () => ({
    id: BOARD_ID,
    name: 'Test board',
    defaultQueue: { key: 'PROJ' },
  }));
  const getBoardColumnsWithStatuses = vi.fn(async () => structuredClone(COLUMNS));
  const listStatuses = vi.fn(async () => structuredClone(STATUSES));

  const listBoardIssuesForSync = vi.fn(
    async (
      _boardId: number,
      filter: { tags?: readonly string[] } = {},
    ) => {
      const all = [...issues.values()].map((row) => structuredClone(row));
      const tags = filter.tags ?? [];
      if (!tags.length) {
        return all;
      }
      const wanted = new Set(tags.map((tag) => String(tag).toLowerCase()));
      return all.filter((issue) =>
        (issue.tags ?? []).some((tag) => wanted.has(String(tag).toLowerCase())),
      );
    },
  );

  const getIssue = vi.fn(async (issueKey: string) => {
    const row = issues.get(issueKey.toUpperCase());
    if (!row) {
      throw new Error(`Issue ${issueKey} not found`);
    }
    return structuredClone(row);
  });

  const findIssuesByKeys = vi.fn(async (issueKeys: readonly string[]) => {
    const found = new Map<string, TrackerIssue>();
    for (const issueKey of issueKeys) {
      const row = issues.get(issueKey.toUpperCase());
      if (row) {
        found.set(issueKey.toUpperCase(), structuredClone(row));
      }
    }
    return found;
  });

  const createIssue = vi.fn(async (input: CreateIssueInput) => {
    const key = `PROJ-${nextId}`;
    nextId += 1;
    const created = issueRow(key, input.summary, {
      description: input.description ?? '',
      tags: input.tags ?? [],
      parent: input.parentKey ? { key: input.parentKey } : null,
      start: input.start ?? null,
      deadline: input.deadline ?? null,
      queue: { key: input.queue },
    });
    issues.set(key, created);
    return structuredClone(created);
  });

  const updateIssue = vi.fn(async (issueKey: string, input: UpdateIssueInput) => {
    const row = issues.get(issueKey.toUpperCase());
    if (!row) {
      throw new Error(`Issue ${issueKey} not found`);
    }
    if (input.summary !== undefined) {
      row.summary = input.summary;
    }
    if (input.description !== undefined) {
      row.description = input.description;
    }
    if (input.tags !== undefined) {
      row.tags = [...input.tags];
    }
    if (input.parentKey !== undefined) {
      row.parent = input.parentKey ? { key: input.parentKey } : null;
    }
    if (input.start !== undefined) {
      row.start = input.start;
    }
    if (input.deadline !== undefined) {
      row.deadline = input.deadline;
    }
    row.updatedAt = '2026-06-01T12:00:01.000Z';
    return structuredClone(row);
  });

  const applyStatus = (issueKey: string, statusKey: string): void => {
    const row = issues.get(issueKey.toUpperCase());
    const target = STATUSES.find(
      (status) => status.key === statusKey || status.id === statusKey,
    );
    if (!row || !target) {
      throw new Error(`No transition to status "${statusKey}" for ${issueKey}`);
    }
    row.status = { id: target.id, key: target.key, display: target.display };
    row.updatedAt = '2026-06-01T12:00:02.000Z';
  };

  const transitionToStatus = vi.fn(async (issueKey: string, statusKey: string) => {
    applyStatus(issueKey, statusKey);
    return [];
  });

  const transitionTowardStatuses = vi.fn(
    async (
      issueKey: string,
      targetStatusIds: readonly string[],
      _options?: { resolution?: string },
    ) => {
      const wanted = new Set(
        targetStatusIds.map((id) => id.trim().toLowerCase()).filter(Boolean),
      );
      const target = STATUSES.find(
        (status) =>
          wanted.has(status.key.toLowerCase()) || wanted.has(status.id.toLowerCase()),
      );
      if (!target) {
        throw new Error(
          `No transition toward [${[...wanted].join(', ')}] for ${issueKey}`,
        );
      }
      applyStatus(issueKey, target.key);
      return true;
    },
  );

  const client = {
    getBoard,
    getBoardColumnsWithStatuses,
    listStatuses,
    listBoardIssuesForSync,
    createIssue,
    updateIssue,
    transitionToStatus,
    transitionTowardStatuses,
    getIssue,
    findIssuesByKeys,
  } as unknown as TrackerClient;

  return {
    client,
    issues,
    createIssue,
    updateIssue,
    transitionToStatus,
    transitionTowardStatuses,
    getIssue,
    findIssuesByKeys,
  };
}

async function runSync(options: {
  note: string;
  mock: MockClientBundle;
  ledger?: LedgerStore;
  pending?: PendingLink[];
  dryRun?: boolean;
  conflictPolicy?: ConflictPolicy;
  labels?: string[];
  queueKey?: string;
  doneResolution?: string;
}): Promise<{
  result: Awaited<ReturnType<typeof syncAllMappings>>;
  written: string;
  writeNote: ReturnType<typeof vi.fn>;
  ledger: LedgerStore;
}> {
  const ledger = options.ledger ?? emptyLedger();
  const pending = options.pending ?? [];
  let written = '';
  const writeNote = vi.fn(async (_path: string, content: string) => {
    written = content;
  });
  const readNote = vi.fn(async () => options.note);

  const result = await syncAllMappings(
    [
      {
        notePath: NOTE_PATH,
        boardId: BOARD_ID,
        labels: options.labels ?? [],
        queueKey: options.queueKey,
      },
    ],
    ledger,
    pending,
    {
      siteBaseUrl: SITE_URL,
      conflictPolicy: options.conflictPolicy ?? 'prefer-obsidian',
      client: options.mock.client,
      doneResolution: options.doneResolution,
      readNote,
      writeNote,
      dryRun: options.dryRun,
      now: () => '2026-06-01T12:00:00.000Z',
    },
  );

  return { result, written, writeNote, ledger };
}

function mappingLedgerKey(issueKey: string): string {
  return ledgerEntryKey(mappingKey(NOTE_PATH, BOARD_ID), issueKey);
}

function seedLedger(
  issueKey: string,
  title: string,
  extra: Partial<Parameters<typeof makeLedgerEntry>[0]> = {},
): LedgerStore {
  const ledger = emptyLedger();
  ledger.entries[mappingLedgerKey(issueKey)] = makeLedgerEntry({
    issueKey,
    mappingKey: mappingKey(NOTE_PATH, BOARD_ID),
    title,
    description: '',
    status: 'todo',
    trackerStatusId: 'open',
    trackerStatusName: 'Open',
    parentIssueKey: null,
    trackerUpdated: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
  return ledger;
}

describe('sync engine', () => {
  it('creates nested child with native Tracker parent', async () => {
    const mock = createMockClient([issueRow('PROJ-1', 'Parent')]);
    const { result } = await runSync({
      note: [link('PROJ-1', 'Parent'), '    - [ ] Child idea', ''].join('\n'),
      mock,
    });

    expect(result.mappings[0]?.errors ?? []).toEqual([]);
    expect(mock.createIssue).toHaveBeenCalledTimes(1);
    const input = mock.createIssue.mock.calls[0]?.[0] as CreateIssueInput;
    expect(input.summary).toBe('Child idea');
    expect(input.queue).toBe('PROJ');
    expect(input.parentKey).toBe('PROJ-1');
  });

  it('creates a remote issue from an unlinked checklist task', async () => {
    const mock = createMockClient();
    const { result, written, writeNote } = await runSync({
      note: '- [ ] Buy milk',
      mock,
    });

    expect(mock.createIssue).toHaveBeenCalledTimes(1);
    expect((mock.createIssue.mock.calls[0]?.[0] as CreateIssueInput).summary).toBe('Buy milk');
    expect(result.mappings[0]?.counts.createdRemote).toBe(1);
    expect(writeNote).toHaveBeenCalledTimes(1);
    expect(written).toContain(`${SITE_URL}/PROJ-100`);
    expect(written).toContain('Buy milk');
  });

  it('prefers the mapping queue key over the board default queue', async () => {
    const mock = createMockClient();
    await runSync({ note: '- [ ] Queue task', mock, queueKey: 'DOC' });
    expect((mock.createIssue.mock.calls[0]?.[0] as CreateIssueInput).queue).toBe('DOC');
  });

  it('transitions new issues into the target column with resolution for done', async () => {
    const mock = createMockClient();
    await runSync({ note: '- [x] Already done', mock, doneResolution: 'fixed' });
    expect(mock.transitionTowardStatuses).toHaveBeenCalledWith(
      'PROJ-100',
      expect.arrayContaining(['closed', '4']),
      { resolution: 'fixed' },
    );
    expect(mock.issues.get('PROJ-100')?.status?.key).toBe('closed');
  });

  it('pushes existing Obsidian done issues to Tracker done', async () => {
    const mock = createMockClient([issueRow('PROJ-7', 'Finish me')]);
    const ledger = seedLedger('PROJ-7', 'Finish me', {
      status: 'todo',
      trackerStatusId: 'open',
      trackerStatusName: 'Open',
    });
    const { result } = await runSync({
      note: link('PROJ-7', 'Finish me', 'x'),
      mock,
      ledger,
    });
    expect(result.mappings[0]?.errors ?? []).toEqual([]);
    expect(mock.transitionTowardStatuses).toHaveBeenCalled();
    expect(mock.issues.get('PROJ-7')?.status?.key).toBe('closed');
  });

  it('hydrates linked issues missing from board search via findIssuesByKeys', async () => {
    const mock = createMockClient([issueRow('CL-448', 'Домен для медиа-мониторинга (стейдж)')]);
    // Simulate sprint-scoped board search that omits backlog To Do cards.
    (
      mock.client as unknown as { listBoardIssuesForSync: ReturnType<typeof vi.fn> }
    ).listBoardIssuesForSync = vi.fn(async () => []);
    const ledger = seedLedger('CL-448', 'Домен для медиа-мониторинга (стейдж)');
    const { result } = await runSync({
      note: link('CL-448', 'Домен для медиа-мониторинга (стейдж)', 'x'),
      mock,
      ledger,
    });
    expect(result.mappings[0]?.counts.unresolvedRemovals ?? 0).toBe(0);
    expect(mock.findIssuesByKeys).toHaveBeenCalledWith(['CL-448']);
    expect(mock.transitionTowardStatuses).toHaveBeenCalled();
  });

  it('creates a local task from a remote-only board issue', async () => {
    const mock = createMockClient([
      issueRow('PROJ-55', 'Orphan remote', { description: 'Line one\nLine two' }),
    ]);
    const { result, written, writeNote } = await runSync({ note: '# Notes\n', mock });

    expect(result.mappings[0]?.counts.createdLocal).toBe(1);
    expect(writeNote).toHaveBeenCalledTimes(1);
    expect(written).toContain('[Orphan remote]');
    expect(written).toContain(`${SITE_URL}/PROJ-55`);
    expect(written).toContain('- Line one');
  });

  it('imports blocked remote issues as review checkbox and restores missing locals', async () => {
    const mock = createMockClient([
      issueRow('PROJ-80', 'Stuck waiting', {
        status: { id: '9', key: 'blocked', display: 'Blocked', type: 'paused' },
      }),
    ]);
    const ledger = seedLedger('PROJ-80', 'Stuck waiting', {
      status: 'review',
      trackerStatusId: 'blocked',
      trackerStatusName: 'Blocked',
    });
    const { result, written } = await runSync({ note: '# Notes\n', mock, ledger });
    expect(result.mappings[0]?.counts.createdLocal).toBe(1);
    expect(result.mappings[0]?.counts.unresolvedRemovals ?? 0).toBe(0);
    expect(written).toContain('- [?] [Stuck waiting]');
    expect(written).toContain(`${SITE_URL}/PROJ-80`);
  });

  it('pushes a local title change to Tracker', async () => {
    const mock = createMockClient([issueRow('PROJ-1', 'Old title')]);
    const { result } = await runSync({
      note: link('PROJ-1', 'New title'),
      mock,
      ledger: seedLedger('PROJ-1', 'Old title'),
    });

    expect(result.mappings[0]?.counts.pushed).toBe(1);
    const updateCall = mock.updateIssue.mock.calls.find((call) => call[0] === 'PROJ-1');
    expect(updateCall?.[1]?.summary).toBe('New title');
  });

  it('pulls a remote title change into the note', async () => {
    const mock = createMockClient([
      issueRow('PROJ-2', 'Remote title', { updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    const { result, written, writeNote } = await runSync({
      note: link('PROJ-2', 'Old title'),
      mock,
      ledger: seedLedger('PROJ-2', 'Old title'),
    });

    expect(result.mappings[0]?.counts.pulled).toBe(1);
    expect(writeNote).toHaveBeenCalledTimes(1);
    expect(written).toContain('[Remote title]');
  });

  it('resolves conflicts with prefer-obsidian by pushing', async () => {
    const mock = createMockClient([
      issueRow('PROJ-3', 'Remote title', { updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    const { result } = await runSync({
      note: link('PROJ-3', 'Obsidian title'),
      mock,
      ledger: seedLedger('PROJ-3', 'Ledger title'),
      conflictPolicy: 'prefer-obsidian',
    });

    expect(result.mappings[0]?.counts.conflictsResolved).toBe(1);
    expect(
      result.mappings[0]?.actions.some((action) => action.kind === 'conflict-push'),
    ).toBe(true);
    const updateCall = mock.updateIssue.mock.calls.find((call) => call[0] === 'PROJ-3');
    expect(updateCall?.[1]?.summary).toBe('Obsidian title');
  });

  it('resolves conflicts with prefer-tracker by pulling', async () => {
    const mock = createMockClient([
      issueRow('PROJ-4', 'Remote wins', { updatedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    const { result, written } = await runSync({
      note: link('PROJ-4', 'Obsidian title'),
      mock,
      ledger: seedLedger('PROJ-4', 'Ledger title'),
      conflictPolicy: 'prefer-tracker',
    });

    expect(result.mappings[0]?.counts.conflictsResolved).toBe(1);
    expect(
      result.mappings[0]?.actions.some((action) => action.kind === 'conflict-pull'),
    ).toBe(true);
    expect(written).toContain('[Remote wins]');
  });

  it('reconciles Review tags without leaving Review when checkbox stays [?]', async () => {
    const mock = createMockClient([
      issueRow('PROJ-7', 'In review', {
        status: { id: '3', key: 'review', display: 'Review' },
        tags: ['in-progress', 'bug'],
      }),
    ]);
    const { result } = await runSync({
      note: link('PROJ-7', 'In review', '?'),
      mock,
      ledger: seedLedger('PROJ-7', 'In review', {
        status: 'review',
        trackerStatusId: 'review',
        trackerStatusName: 'Review',
      }),
    });

    expect(result.mappings[0]?.counts.unchanged).toBe(1);
    expect(result.mappings[0]?.counts.labelReconciliations).toBe(1);
    expect(mock.transitionToStatus).not.toHaveBeenCalled();
    const tagUpdate = mock.updateIssue.mock.calls.find(
      (call) => call[0] === 'PROJ-7' && call[1]?.tags !== undefined,
    );
    expect(tagUpdate?.[1]?.tags).toEqual(['bug', 'review']);
  });

  it('does not write the note in dry-run mode', async () => {
    const mock = createMockClient();
    const { writeNote, ledger } = await runSync({
      note: '- [ ] Dry run task',
      mock,
      dryRun: true,
    });

    expect(writeNote).not.toHaveBeenCalled();
    expect(Object.keys(ledger.entries)).toHaveLength(0);
    expect(mock.createIssue).not.toHaveBeenCalled();
  });

  it('recovers a pending link instead of creating a duplicate issue', async () => {
    const mock = createMockClient();
    const pending: PendingLink[] = [
      {
        mappingKey: mappingKey(NOTE_PATH, BOARD_ID),
        issueKey: 'PROJ-88',
        title: 'Pending task',
        description: '',
        status: 'todo',
        parentIssueKey: null,
        trackerUpdated: '2026-05-01T00:00:00.000Z',
      },
    ];

    const { result, written, writeNote } = await runSync({
      note: '- [ ] Pending task',
      mock,
      pending,
    });

    expect(mock.createIssue).not.toHaveBeenCalled();
    expect(result.mappings[0]?.counts.recoveredPendingLinks).toBe(1);
    expect(writeNote).toHaveBeenCalledTimes(1);
    expect(written).toContain('/PROJ-88');
    expect(
      result.mappings[0]?.actions.some((action) => action.kind === 'recovered-pending'),
    ).toBe(true);
  });

  it('imports only board issues matching the mapping tag filter', async () => {
    const mock = createMockClient([
      issueRow('PROJ-1', 'Alpha task', { tags: ['project-a'] }),
      issueRow('PROJ-2', 'Beta task', { tags: ['project-b'] }),
      issueRow('PROJ-3', 'Untagged task', { tags: [] }),
    ]);

    const { result, written } = await runSync({
      note: '# Notes\n',
      mock,
      labels: ['project-a'],
    });

    expect(result.mappings[0]?.counts.createdLocal).toBe(1);
    expect(written).toContain('Alpha task');
    expect(written).not.toContain('Beta task');
    expect(written).not.toContain('Untagged task');
  });

  it('attaches mapping filter tags when creating a remote issue', async () => {
    const mock = createMockClient();
    await runSync({
      note: '- [ ] Tagged from note',
      mock,
      labels: ['project-a'],
    });

    const tags = (mock.createIssue.mock.calls[0]?.[0] as CreateIssueInput).tags;
    expect(tags).toEqual(expect.arrayContaining(['project-a', 'to-do']));
  });

  it('imports start and due (end wins over deadline) and converts spent ms to seconds', async () => {
    const mock = createMockClient([
      issueRow('PROJ-50', 'Timed task', {
        start: '2026-10-01',
        end: '2026-10-03',
        deadline: '2026-10-10',
        spent: 3_600_000,
      }),
    ]);

    const { written } = await runSync({ note: '# Notes\n', mock });

    expect(written).toContain('Timed task');
    expect(written).toContain('🛫 2026-10-01');
    expect(written).toContain('📅 2026-10-03');
    expect(written).toContain('[timespent:: 3600]');
  });

  it('pushes Obsidian due date to deadline only', async () => {
    const mock = createMockClient([
      issueRow('PROJ-51', 'Due push', { deadline: '2026-10-10', end: '2026-10-03' }),
    ]);

    // First sync establishes the ledger with the pulled (end) due date.
    const { ledger } = await runSync({
      note: `${link('PROJ-51', 'Due push')} 📅 2026-11-01\n`,
      mock,
      conflictPolicy: 'prefer-tracker',
    });

    await runSync({
      note: `${link('PROJ-51', 'Due push')} 📅 2026-11-15\n`,
      mock,
      ledger,
      conflictPolicy: 'prefer-obsidian',
    });

    const duePush = mock.updateIssue.mock.calls.find(
      (call) => call[0] === 'PROJ-51' && call[1]?.deadline === '2026-11-15',
    );
    expect(duePush).toBeTruthy();
    const endWrites = mock.updateIssue.mock.calls.filter(
      (call) => (call[1] as Record<string, unknown>)?.end !== undefined,
    );
    expect(endWrites).toHaveLength(0);
  });
});
