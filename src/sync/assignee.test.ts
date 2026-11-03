import { describe, expect, it } from 'vitest';
import {
  collectAssigneesFromIssues,
  decideAssigneeReconcile,
  normalizeAssigneeMappings,
  toTrackerAssigneeValue,
} from './assignee';

const mappings = normalizeAssigneeMappings([
  {
    trackerUserId: '1120000000012345',
    trackerDisplayName: 'Aryapov',
    obsidianValue: 'Аряпов',
  },
  {
    trackerUserId: 'uid-razin',
    trackerDisplayName: 'Razin',
    trackerLogin: 'razin',
    obsidianValue: 'Разин',
  },
]);

describe('assignee reconcile decisions', () => {
  it('sets Obsidian when local empty and Tracker is mapped', () => {
    expect(
      decideAssigneeReconcile({
        localAssignee: null,
        remoteAssigneeId: '1120000000012345',
        mappings,
      }),
    ).toMatchObject({
      action: 'set-local',
      obsidianValue: 'Аряпов',
    });
  });

  it('sets Tracker when Obsidian has a mapped value and Tracker is empty', () => {
    expect(
      decideAssigneeReconcile({
        localAssignee: 'Разин',
        remoteAssigneeId: null,
        mappings,
      }),
    ).toMatchObject({
      action: 'set-remote',
      mapping: { trackerUserId: 'uid-razin' },
    });
  });

  it('lets Obsidian win when values differ', () => {
    expect(
      decideAssigneeReconcile({
        localAssignee: 'Аряпов',
        remoteAssigneeId: 'uid-razin',
        mappings,
      }),
    ).toMatchObject({
      action: 'set-remote',
      mapping: { trackerUserId: '1120000000012345' },
    });
  });

  it('no-ops when unmapped or already aligned', () => {
    expect(
      decideAssigneeReconcile({
        localAssignee: null,
        remoteAssigneeId: 'unknown',
        mappings,
      }),
    ).toEqual({ action: 'none' });
    expect(
      decideAssigneeReconcile({
        localAssignee: 'Аряпов',
        remoteAssigneeId: '1120000000012345',
        mappings,
      }),
    ).toEqual({ action: 'none' });
  });

  it('builds Tracker assignee value (login preferred)', () => {
    expect(toTrackerAssigneeValue(mappings[0]!)).toBe('1120000000012345');
    expect(toTrackerAssigneeValue(mappings[1]!)).toBe('razin');
  });

  it('collects known assignees from Tracker issues', () => {
    expect(
      collectAssigneesFromIssues([
        { assignee: { id: '1', login: 'a', display: 'Alpha' } },
        { assignee: { id: '1', login: 'a', display: 'Alpha' } },
        { assignee: null },
      ]),
    ).toEqual([{ id: '1', displayName: 'Alpha', login: 'a' }]);
  });
});
