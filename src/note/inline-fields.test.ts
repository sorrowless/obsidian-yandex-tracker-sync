import { describe, expect, it } from 'vitest';
import {
  formatUnknownInlineFieldsSuffix,
  parseUnknownInlineFields,
} from './inline-fields';

describe('unknown inline fields', () => {
  it('captures unknown Dataview fields and leaves known keys out', () => {
    const parsed = parseUnknownInlineFields(
      '[jira:: ABC-1] [foo:: bar baz] leftover',
    );
    expect(parsed.unknownInlineFields).toEqual(['[jira:: ABC-1]', '[foo:: bar baz]']);
    expect(parsed.remainder).toBe('leftover');
  });

  it('formats preserved fields back', () => {
    expect(formatUnknownInlineFieldsSuffix(['[jira:: ABC-1]', '[foo:: x]'])).toBe(
      ' [jira:: ABC-1] [foo:: x]',
    );
  });
});
