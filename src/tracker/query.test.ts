import { describe, expect, it } from 'vitest';
import {
  boardScopeQuery,
  buildRecencyClause,
  buildTagsClause,
  columnStatusesClause,
  combineQueryParts,
  pausedStatusTypeClause,
  queueScopeQuery,
  quoteQueryValue,
} from './query';

describe('tracker query helpers', () => {
  it('quotes values with spaces', () => {
    expect(quoteQueryValue('simple')).toBe('simple');
    expect(quoteQueryValue('has space')).toBe('"has space"');
  });

  it('builds tag OR clauses', () => {
    expect(buildTagsClause([])).toBeNull();
    expect(buildTagsClause(['a'])).toBe('Tags: a');
    expect(buildTagsClause(['a', 'b'])).toBe('Tags: a OR Tags: b');
  });

  it('builds recency clauses', () => {
    expect(buildRecencyClause({ field: 'updated', value: 0, unit: 'days' })).toBeNull();
    expect(buildRecencyClause({ field: 'updated', value: 30, unit: 'days' })).toBe(
      'Updated: >today()-30d',
    );
    expect(buildRecencyClause({ field: 'created', value: 3, unit: 'months' })).toBe(
      'Created: >today()-3M',
    );
  });

  it('combines board query, tags, and recency', () => {
    expect(
      combineQueryParts('"Sprints By Board": 1', ['backend', 'api'], {
        field: 'updated',
        value: 7,
        unit: 'days',
      }),
    ).toBe('"Sprints By Board": 1 AND (Tags: backend OR Tags: api) AND Updated: >today()-7d');
  });

  it('builds board and queue scope clauses', () => {
    expect(boardScopeQuery(14)).toBe('"Sprints By Board": 14');
    expect(queueScopeQuery('DOC')).toBe('Queue: DOC');
    // Never emit the invalid `Board: id` form (parsed as a saved Filter name).
    expect(boardScopeQuery(14)).not.toMatch(/^Board:/);
  });

  it('builds status clauses for columns and paused type', () => {
    expect(columnStatusesClause(['open', 'blocked', 'open'])).toBe('Status: open, blocked');
    // Pure numeric ids are omitted — they break Tracker Status: queries.
    expect(columnStatusesClause(['open', '9', 'blocked'])).toBe('Status: open, blocked');
    expect(columnStatusesClause(['9', '10'])).toBeNull();
    expect(columnStatusesClause([])).toBeNull();
    expect(pausedStatusTypeClause()).toBe('"Status Type": paused');
  });
});
