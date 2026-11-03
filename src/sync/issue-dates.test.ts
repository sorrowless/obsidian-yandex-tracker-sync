import { describe, expect, it } from 'vitest';
import {
  buildTrackerDatePayload,
  formatDurationSeconds,
  resolveIssueDates,
  subtractSecondsFromIso,
} from './issue-dates';

describe('issue date resolution', () => {
  it('prefers end over deadline for due date', () => {
    const resolved = resolveIssueDates({
      start: '2026-10-01',
      end: '2026-10-03',
      deadline: '2026-10-10',
    });
    expect(resolved.dueDateSource).toBe('end');
    expect(resolved.dueDate).toBeTruthy();
    expect(resolved.deadline).toBeTruthy();
    expect(resolved.startDateSource).toBe('start');
    expect(resolved.startDate).toBeTruthy();
  });

  it('uses deadline when end is empty', () => {
    const resolved = resolveIssueDates({ deadline: '2026-10-10' });
    expect(resolved.dueDateSource).toBe('deadline');
    expect(resolved.dueDate).toBeTruthy();
  });

  it('leaves dates empty when unset', () => {
    const resolved = resolveIssueDates({});
    expect(resolved.dueDate).toBeNull();
    expect(resolved.dueDateSource).toBeNull();
    expect(resolved.startDate).toBeNull();
    expect(resolved.startDateSource).toBeNull();
    expect(resolveIssueDates(null).startDate).toBeNull();
  });

  it('writes Obsidian start/due to Tracker start/deadline only', () => {
    expect(
      buildTrackerDatePayload({ startDate: '2026-10-01', dueDate: '2026-10-05T12:00:00.000Z' }),
    ).toEqual({
      start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      deadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(buildTrackerDatePayload({})).toEqual({ start: null, deadline: null });
  });

  it('formats durations and subtracts seconds', () => {
    expect(formatDurationSeconds(3600)).toBe('1h');
    expect(formatDurationSeconds(5400)).toBe('1h 30m');
    expect(subtractSecondsFromIso('2026-10-03T08:00:00.000Z', 3600)).toBe(
      '2026-10-03T07:00:00.000Z',
    );
  });
});
