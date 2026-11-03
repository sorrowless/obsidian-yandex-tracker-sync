import { describe, expect, it } from 'vitest';
import {
  formatTimeSpentSuffix,
  normalizeTimeSpentSeconds,
  parseTimeSpentField,
} from './timespent';

describe('timespent dataview field', () => {
  it('parses [timespent:: N] and strips it from the remainder', () => {
    const parsed = parseTimeSpentField(
      'Title 📅 2026-10-05 [assignee:: X] [timespent:: 3600]',
    );
    expect(parsed.timeSpentSeconds).toBe(3600);
    expect(parsed.remainder).toBe('Title 📅 2026-10-05 [assignee:: X]');
  });

  it('rejects non-integer values', () => {
    expect(parseTimeSpentField('[timespent:: 1.5]').timeSpentSeconds).toBeNull();
    expect(normalizeTimeSpentSeconds(-1)).toBeNull();
    expect(normalizeTimeSpentSeconds(0)).toBe(0);
  });

  it('formats a trailing Dataview field', () => {
    expect(formatTimeSpentSuffix(3600)).toBe(' [timespent:: 3600]');
    expect(formatTimeSpentSuffix(null)).toBe('');
  });
});
