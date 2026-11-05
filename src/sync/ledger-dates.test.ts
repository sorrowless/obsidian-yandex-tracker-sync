import { describe, expect, it } from 'vitest';
import {
  contentCoreEqual,
  contentHash,
  contentSnapshot,
  syncCalendarDay,
} from './ledger';

describe('sync calendar day hashing', () => {
  it('maps ISO values to YYYY-MM-DD in the local timezone', () => {
    const day = syncCalendarDay('2026-10-01T15:30:00.000Z');
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('treats two ISOs with the same syncCalendarDay as core-equal', () => {
    const localMidnight = new Date(2026, 9, 1, 0, 0, 0, 0).toISOString();
    const laterSameLocalDay = new Date(2026, 9, 1, 18, 0, 0, 0).toISOString();
    expect(syncCalendarDay(localMidnight)).toBe(syncCalendarDay(laterSameLocalDay));

    const a = contentSnapshot({
      title: ' A ',
      description: '',
      status: 'todo',
      trackerStatusId: 'open',
      trackerStatusName: 'Open',
      parentIssueKey: null,
      startDate: localMidnight,
      dueDate: null,
    });
    const b = contentSnapshot({
      title: 'A',
      description: '',
      status: 'todo',
      trackerStatusId: 'open',
      trackerStatusName: 'Open',
      parentIssueKey: null,
      startDate: laterSameLocalDay,
      dueDate: null,
    });
    expect(contentCoreEqual(a, b)).toBe(true);
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('distinguishes different calendar days', () => {
    const a = contentSnapshot({
      title: 'A',
      description: '',
      status: 'todo',
      trackerStatusId: '',
      trackerStatusName: '',
      parentIssueKey: null,
      dueDate: new Date(2026, 9, 3, 0, 0, 0, 0).toISOString(),
    });
    const b = contentSnapshot({
      title: 'A',
      description: '',
      status: 'todo',
      trackerStatusId: '',
      trackerStatusName: '',
      parentIssueKey: null,
      dueDate: new Date(2026, 10, 15, 0, 0, 0, 0).toISOString(),
    });
    expect(contentCoreEqual(a, b)).toBe(false);
  });
});
