import { describe, expect, it } from 'vitest';
import {
  formatTaskDatesSuffix,
  parseTaskDates,
  toTrackerDueDatePayload,
} from './dates';

describe('task dates', () => {
  it('parses start and due markers', () => {
    const parsed = parseTaskDates('Title 🛫 2026-10-02 📅 2026-10-05');
    expect(parsed.remainder).toBe('Title');
    expect(parsed.startDate).toBeTruthy();
    expect(parsed.dueDate).toBeTruthy();
  });

  it('formats suffix', () => {
    const start = '2026-10-02T00:00:00.000Z';
    // Use local midnight via parse to avoid TZ flake for suffix presence
    const parsed = parseTaskDates('x 🛫 2026-10-02 📅 2026-10-05');
    expect(formatTaskDatesSuffix(parsed.startDate, parsed.dueDate)).toContain('🛫');
    expect(formatTaskDatesSuffix(parsed.startDate, parsed.dueDate)).toContain('📅');
    expect(toTrackerDueDatePayload(start)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
