import { describe, expect, it } from 'vitest';
import type { SyncRunResult } from './engine';
import { collectSyncErrors, formatSyncNotice, formatSyncReport } from './report';

function sampleResult(overrides?: Partial<SyncRunResult>): SyncRunResult {
  return {
    dryRun: true,
    message:
      'Tracker Sync dry-run: 1 mapping, 2 would create in Tracker, 1 unresolved, 1 error',
    mappings: [
      {
        notePath: 'Tasks/Work.md',
        boardId: 3,
        labels: ['project-a'],
        recency: { field: 'updated', value: 90, unit: 'days' },
        counts: {
          createdRemote: 2,
          createdLocal: 0,
          pushed: 0,
          pulled: 0,
          conflictsResolved: 0,
          unchanged: 0,
          unresolvedRemovals: 1,
          recoveredPendingLinks: 0,
          duplicateSkips: 0,
          labelReconciliations: 0,
          assigneeReconciliations: 0,
          timeSpentReconciliations: 0,
        },
        actions: [
          {
            kind: 'create-remote',
            title: 'Buy milk',
            detail: 'unlinked checklist item in the note',
          },
          {
            kind: 'create-remote',
            title: 'Call dentist',
            detail: 'unlinked checklist item in the note',
          },
          {
            kind: 'unresolved-missing-local',
            title: 'Old remote task',
            issueKey: 'PROJ-42',
            detail: 'was synced before, still exists in Tracker, but is no longer in the note',
          },
        ],
        errors: ['Note not found: Tasks/Work.md'],
        unresolvedIssueKeys: ['PROJ-42'],
        pendingLinks: [],
      },
    ],
    ...overrides,
  };
}

describe('sync report formatting', () => {
  it('includes concrete action titles and errors in the notice', () => {
    const notice = formatSyncNotice(sampleResult());
    expect(notice).toContain('would create in Tracker');
    expect(notice).toContain('Buy milk');
    expect(notice).toContain('Call dentist');
    expect(notice).toContain('Unresolved — known from ledger, missing in note');
    expect(notice).toContain('Old remote task');
    expect(notice).toContain('1 error');
    expect(notice).toContain('Tasks/Work.md: Note not found: Tasks/Work.md');
  });

  it('collects errors with mapping labels', () => {
    expect(collectSyncErrors(sampleResult())).toEqual([
      'Tasks/Work.md: Note not found: Tasks/Work.md',
    ]);
  });

  it('builds a full report with per-task action lists and errors', () => {
    const report = formatSyncReport(sampleResult());
    expect(report).toContain(
      'Tasks/Work.md → board 3 [labels: project-a; updated >= -90d]',
    );
    expect(report).toContain('Would create in Tracker (2):');
    expect(report).toContain('• Buy milk');
    expect(report).toContain('Unresolved — known from ledger, missing in note (1):');
    expect(report).toContain('Old remote task [PROJ-42]');
    expect(report).toContain('Errors');
    expect(report).toContain('Note not found: Tasks/Work.md');
  });
});
