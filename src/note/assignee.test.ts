import { describe, expect, it } from 'vitest';
import {
  formatAssigneeSuffix,
  parseAssigneeField,
} from './assignee';

describe('assignee dataview field', () => {
  it('parses [assignee:: value] and strips it from the remainder', () => {
    const parsed = parseAssigneeField('Title 📅 2026-10-05 [assignee:: Аряпов]');
    expect(parsed.assignee).toBe('Аряпов');
    expect(parsed.remainder).toBe('Title 📅 2026-10-05');
  });

  it('formats a trailing Dataview field', () => {
    expect(formatAssigneeSuffix('Разин')).toBe(' [assignee:: Разин]');
    expect(formatAssigneeSuffix('')).toBe('');
    expect(formatAssigneeSuffix(null)).toBe('');
  });
});
