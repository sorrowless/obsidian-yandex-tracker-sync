import { describe, expect, it } from 'vitest';
import { renderTask } from './writer';

const SITE = 'https://tracker.example';

describe('dual-link writer', () => {
  it('keeps external title URL and appends ytracker', () => {
    const line = renderTask(
      {
        indent: '',
        listMarker: '-',
        checkboxChar: '/',
        title: 'Jira title',
        issueKey: 'CL-406',
        titleLinkUrl: 'https://jira.example/browse/ABC-1',
        ytrackerIssueKey: 'CL-406',
        unknownInlineFields: ['[jira:: keep]'],
        descriptionLines: [],
        children: [],
      },
      SITE,
    );
    expect(line).toBe(
      '- [/] [Jira title](https://jira.example/browse/ABC-1) [ytracker:: [CL-406](https://tracker.example/CL-406)] [jira:: keep]',
    );
  });

  it('omits ytracker for classic Tracker title links', () => {
    const line = renderTask(
      {
        indent: '',
        listMarker: '-',
        checkboxChar: ' ',
        title: 'Native',
        issueKey: 'CL-1',
        titleLinkUrl: 'https://tracker.example/CL-1',
        ytrackerIssueKey: 'CL-1',
        descriptionLines: [],
        children: [],
      },
      SITE,
    );
    expect(line).toBe('- [ ] [Native](https://tracker.example/CL-1)');
    expect(line).not.toContain('ytracker');
  });
});
