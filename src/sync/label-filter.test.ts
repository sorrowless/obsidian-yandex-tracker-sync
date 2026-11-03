import { describe, expect, it } from 'vitest';
import {
  formatLabelList,
  issueMatchesLabelFilter,
  mergeMappingLabels,
  normalizeMappingLabels,
  parseLabelListInput,
} from './label-filter';
import { mappingKey } from './ledger';

describe('label filter helpers', () => {
  it('normalizes and de-dupes labels', () => {
    expect(normalizeMappingLabels([' Beta ', 'alpha', 'ALPHA', ''])).toEqual(['alpha', 'Beta']);
  });

  it('parses comma-separated input', () => {
    expect(parseLabelListInput('project-a, backend; misc')).toEqual([
      'backend',
      'misc',
      'project-a',
    ]);
    expect(formatLabelList(['b', 'a'])).toBe('a, b');
  });

  it('empty filter matches everything', () => {
    expect(issueMatchesLabelFilter(['x'], [])).toBe(true);
    expect(issueMatchesLabelFilter([], [])).toBe(true);
  });

  it('OR-matches any filter label case-insensitively', () => {
    expect(issueMatchesLabelFilter(['Project-A', 'bug'], ['project-a'])).toBe(true);
    expect(issueMatchesLabelFilter(['bug'], ['project-a', 'project-b'])).toBe(false);
    expect(issueMatchesLabelFilter(['project-b'], ['project-a', 'project-b'])).toBe(true);
  });

  it('merges mapping labels without duplicates', () => {
    expect(mergeMappingLabels(['bug', 'Project-A'], ['project-a', 'backend'])).toEqual([
      'bug',
      'Project-A',
      'backend',
    ]);
  });

  it('mappingKey stays back-compat when unfiltered', () => {
    expect(mappingKey('a.md', 3)).toBe('a.md::3');
    expect(mappingKey('a.md', 3, [])).toBe('a.md::3');
    expect(mappingKey('a.md', 3, ['project-a', 'backend'])).toBe('a.md::3::project-a+backend');
  });
});
