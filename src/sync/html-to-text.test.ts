import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './html-to-text';
import { descriptionFromLines, descriptionToLines } from './ledger';

describe('htmlToPlainText', () => {
  it('strips paragraph and break tags into plain lines', () => {
    expect(htmlToPlainText('<p>Cover architecture</p><p>Cover sync rules</p>')).toBe(
      'Cover architecture\nCover sync rules',
    );
    expect(htmlToPlainText('Line one<br>Line two<br/>Line three')).toBe(
      'Line one\nLine two\nLine three',
    );
  });

  it('decodes entities and flattens lists', () => {
    expect(htmlToPlainText('<p>A &amp; B</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'A & B\n- One\n- Two',
    );
  });

  it('returns plain text unchanged', () => {
    expect(htmlToPlainText('Already plain\ntext')).toBe('Already plain\ntext');
  });
});

describe('descriptionToLines', () => {
  it('turns Vikunja HTML descriptions into plain bullet lines', () => {
    expect(
      descriptionToLines('<p>Cover architecture</p><p>Cover sync rules</p>'),
    ).toEqual(['Cover architecture', 'Cover sync rules']);
  });

  it('round-trips plain lines without introducing HTML', () => {
    const lines = ['Cover architecture', 'Cover sync rules'];
    expect(descriptionToLines(descriptionFromLines(lines))).toEqual(lines);
  });
});
