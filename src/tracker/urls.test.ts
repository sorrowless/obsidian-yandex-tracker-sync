import { describe, expect, it } from 'vitest';
import {
  extractIssueKeyFromUrl,
  issueBrowseUrl,
  isIssueKey,
  normalizeBaseUrl,
  parseMarkdownLink,
  parseMarkdownLinkAtStart,
} from './urls';

describe('tracker urls', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeBaseUrl('https://tracker.yandex.ru/')).toBe('https://tracker.yandex.ru');
  });

  it('builds site issue URLs', () => {
    expect(issueBrowseUrl('https://tracker.yandex.ru', 'proj-12')).toBe(
      'https://tracker.yandex.ru/PROJ-12',
    );
  });

  it('extracts issue keys from site URLs', () => {
    expect(
      extractIssueKeyFromUrl('https://tracker.yandex.ru/PROJ-12?foo=1', 'https://tracker.yandex.ru'),
    ).toBe('PROJ-12');
    expect(
      extractIssueKeyFromUrl('https://other.example/PROJ-12', 'https://tracker.yandex.ru'),
    ).toBeNull();
  });

  it('validates issue keys', () => {
    expect(isIssueKey('DOC-1')).toBe(true);
    expect(isIssueKey('not-a-key')).toBe(false);
  });

  it('parses simple markdown links', () => {
    expect(parseMarkdownLink('[Title](https://tracker.yandex.ru/A-1)')).toEqual({
      title: 'Title',
      url: 'https://tracker.yandex.ru/A-1',
    });
  });

  it('parses nested brackets in link text', () => {
    expect(
      parseMarkdownLink('[[wikilink]](https://tracker.yandex.ru/PROJ-1)'),
    ).toEqual({
      title: '[wikilink]',
      url: 'https://tracker.yandex.ru/PROJ-1',
    });
    expect(
      parseMarkdownLink('[[[nested]]](https://tracker.yandex.ru/PROJ-2)'),
    ).toEqual({
      title: '[[nested]]',
      url: 'https://tracker.yandex.ru/PROJ-2',
    });
  });

  it('parses link with trailing rest', () => {
    expect(
      parseMarkdownLinkAtStart('[Title](https://tracker.yandex.ru/A-1) 🛫 2026-01-01'),
    ).toEqual({
      title: 'Title',
      url: 'https://tracker.yandex.ru/A-1',
      rest: '🛫 2026-01-01',
    });
  });
});
