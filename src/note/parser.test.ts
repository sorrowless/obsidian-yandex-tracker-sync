import { describe, expect, it } from 'vitest';
import { parseNoteTasks } from './parser';

const BASE = 'https://tracker.example';

describe('parseNoteTasks', () => {
  it('parses linked titles that contain square brackets without doubling', () => {
    const roots = parseNoteTasks(
      [
        '- [ ] [[not-fix some task]](https://tracker.example/PROJ-9)',
        '',
      ].join('\n'),
      { trackerSiteBaseUrl: 'https://tracker.example' },
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]?.title).toBe('[not-fix some task]');
    expect(roots[0]?.issueKey).toBe('PROJ-9');
  });

  it('parses linked and unlinked tasks with nesting and dates', () => {
    const md = [
      '- [ ] [Parent](https://tracker.example/PROJ-1) 🛫 2026-10-02 📅 2026-10-05',
      '    - desc line',
      '    - [ ] Child idea',
      '- [/] In progress local',
    ].join('\n');

    const roots = parseNoteTasks(md, { trackerSiteBaseUrl: BASE });
    expect(roots).toHaveLength(2);
    expect(roots[0]?.issueKey).toBe('PROJ-1');
    expect(roots[0]?.title).toBe('Parent');
    expect(roots[0]?.descriptionLines).toEqual(['desc line']);
    expect(roots[0]?.children).toHaveLength(1);
    expect(roots[0]?.children[0]?.issueKey).toBeNull();
    expect(roots[0]?.children[0]?.title).toBe('Child idea');
    expect(roots[1]?.status).toBe('in_progress');
  });

  it('ignores foreign browse links', () => {
    const roots = parseNoteTasks(
      '- [ ] [X](https://other.example/PROJ-1)',
      { trackerSiteBaseUrl: BASE },
    );
    expect(roots[0]?.issueKey).toBeNull();
    expect(roots[0]?.title).toBe('X');
    expect(roots[0]?.titleLinkUrl).toBe('https://other.example/PROJ-1');
  });

  it('binds issueKey from ytracker when title link is external', () => {
    const roots = parseNoteTasks(
      '- [/] [Jira title](https://jira.example/browse/ABC-1) [ytracker:: [CL-406](https://tracker.example/CL-406)] [jira:: keep]',
      { trackerSiteBaseUrl: BASE },
    );
    expect(roots[0]?.title).toBe('Jira title');
    expect(roots[0]?.titleLinkUrl).toBe('https://jira.example/browse/ABC-1');
    expect(roots[0]?.ytrackerIssueKey).toBe('CL-406');
    expect(roots[0]?.issueKey).toBe('CL-406');
    expect(roots[0]?.unknownInlineFields).toEqual(['[jira:: keep]']);
  });

  it('parses Dataview assignee fields', () => {
    const roots = parseNoteTasks(
      '- [ ] [Parent](https://tracker.example/PROJ-1) 📅 2026-10-05 [assignee:: Аряпов]',
      { trackerSiteBaseUrl: BASE },
    );
    expect(roots[0]?.assignee).toBe('Аряпов');
    expect(roots[0]?.title).toBe('Parent');
    expect(roots[0]?.dueDate).toBeTruthy();
  });

  it('parses Dataview timespent fields', () => {
    const roots = parseNoteTasks(
      '- [ ] [Parent](https://tracker.example/PROJ-1) [assignee:: Аряпов] [timespent:: 3600]',
      { trackerSiteBaseUrl: BASE },
    );
    expect(roots[0]?.timeSpentSeconds).toBe(3600);
    expect(roots[0]?.assignee).toBe('Аряпов');
  });
});
