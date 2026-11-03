import { describe, expect, it } from 'vitest';
import {
  buildSyncQuery,
  describeIssueSyncFilter,
  normalizeIssueSyncFilter,
} from './issue-filter';

describe('issue sync filter', () => {
  it('normalizes legacy label arrays', () => {
    expect(normalizeIssueSyncFilter(['a', 'b'])).toEqual({
      tags: ['a', 'b'],
      recency: null,
    });
  });

  it('builds sync query from board + tags + recency', () => {
    expect(
      buildSyncQuery('"Sprints By Board": 12', {
        tags: ['ops'],
        recency: { field: 'updated', value: 14, unit: 'days' },
      }),
    ).toBe('"Sprints By Board": 12 AND Tags: ops AND Updated: >today()-14d');
  });

  it('describes filters for errors', () => {
    expect(describeIssueSyncFilter({})).toBe('no extra filters');
    expect(
      describeIssueSyncFilter({
        tags: ['x'],
        recency: { field: 'created', value: 1, unit: 'days' },
      }),
    ).toContain('Tags: x');
  });
});
