import { describe, expect, it } from 'vitest';
import { formatYtrackerSuffix, parseYtrackerField } from './ytracker';

const SITE = 'https://tracker.example';

describe('ytracker field', () => {
  it('parses markdown-link values', () => {
    const parsed = parseYtrackerField(
      ' [ytracker:: [CL-406](https://tracker.example/CL-406)] 📅 2026-01-01',
      SITE,
    );
    expect(parsed.ytrackerIssueKey).toBe('CL-406');
    expect(parsed.remainder).toBe('📅 2026-01-01');
  });

  it('parses bare issue keys', () => {
    const parsed = parseYtrackerField('[ytracker:: CL-1]', SITE);
    expect(parsed.ytrackerIssueKey).toBe('CL-1');
    expect(parsed.remainder).toBe('');
  });

  it('formats the canonical suffix', () => {
    expect(formatYtrackerSuffix('cl-406', SITE)).toBe(
      ' [ytracker:: [CL-406](https://tracker.example/CL-406)]',
    );
  });
});
