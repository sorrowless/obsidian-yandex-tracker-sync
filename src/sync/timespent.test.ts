import { describe, expect, it } from 'vitest';
import {
  decideTimeSpentReconcile,
  extractTrackerTimeSpentSeconds,
  trackerSpentToSeconds,
} from './timespent';

describe('timespent pull-only reconcile', () => {
  it('sets Obsidian when empty or different from Tracker', () => {
    expect(
      decideTimeSpentReconcile({ localSeconds: null, remoteSeconds: 3600 }),
    ).toEqual({
      action: 'set-local',
      seconds: 3600,
      detail: 'set [timespent:: 3600] from Tracker (3600s)',
    });
    expect(
      decideTimeSpentReconcile({ localSeconds: 120, remoteSeconds: 3600 }),
    ).toMatchObject({ action: 'set-local', seconds: 3600 });
  });

  it('no-ops when aligned or remote empty', () => {
    expect(
      decideTimeSpentReconcile({ localSeconds: 3600, remoteSeconds: 3600 }),
    ).toEqual({ action: 'none' });
    expect(
      decideTimeSpentReconcile({ localSeconds: 100, remoteSeconds: null }),
    ).toEqual({ action: 'none' });
  });

  it('converts Tracker spent milliseconds to seconds', () => {
    expect(trackerSpentToSeconds(3_600_000)).toBe(3600);
    expect(trackerSpentToSeconds('90000')).toBe(90);
    expect(trackerSpentToSeconds(0)).toBeNull();
    expect(trackerSpentToSeconds(null)).toBeNull();
    expect(trackerSpentToSeconds('PT1H30M')).toBe(5400);
    expect(extractTrackerTimeSpentSeconds({ spent: 120_000 })).toBe(120);
    expect(extractTrackerTimeSpentSeconds({})).toBeNull();
  });
});
