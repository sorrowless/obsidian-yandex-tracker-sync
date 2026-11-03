import { describe, expect, it } from 'vitest';
import { toRemoteIssueView } from './remote';
import type { TrackerIssue } from '../tracker/types';
import {
  checkboxFromStatus,
  inferColumnCoarseStatus,
  pickColumnForCoarseStatus,
  statusFromCheckbox,
  statusFromTrackerStatus,
  statusLabelFromColumnName,
} from './status';

describe('status mapping', () => {
  it('maps checkboxes', () => {
    expect(statusFromCheckbox(' ')).toBe('todo');
    expect(statusFromCheckbox('/')).toBe('in_progress');
    expect(statusFromCheckbox('?')).toBe('review');
    expect(statusFromCheckbox('x')).toBe('done');
    expect(checkboxFromStatus('in_progress')).toBe('/');
    expect(checkboxFromStatus('review')).toBe('?');
  });

  it('maps Tracker status names and types', () => {
    expect(statusFromTrackerStatus('Open', 'new')).toBe('todo');
    expect(statusFromTrackerStatus('In Progress', 'inProgress')).toBe('in_progress');
    expect(statusFromTrackerStatus('Review', 'inProgress')).toBe('review');
    expect(statusFromTrackerStatus('Ревью')).toBe('review');
    expect(statusFromTrackerStatus('На ревью')).toBe('review');
    expect(statusFromTrackerStatus('Closed', 'done')).toBe('done');
    expect(statusFromTrackerStatus('Выполнено')).toBe('done');
    expect(statusFromTrackerStatus('Completed')).toBe('done');
    expect(statusFromTrackerStatus('Открыт', 'new')).toBe('todo');
    expect(statusFromTrackerStatus('QA', 'inProgress')).toBe('in_progress');
  });

  it('maps Blocked and paused to review', () => {
    expect(statusFromTrackerStatus('Blocked')).toBe('review');
    expect(statusFromTrackerStatus('Заблокировано')).toBe('review');
    expect(statusFromTrackerStatus('Need Info', 'paused')).toBe('review');
    expect(statusFromTrackerStatus('In Review')).toBe('review');
    expect(statusFromTrackerStatus('Waiting for review')).toBe('review');
  });

  it('does not fall back done onto an arbitrary last column', () => {
    const columns = [
      { name: 'Icebox', statusIds: ['x'] },
      { name: 'To Do', statusIds: ['1'] },
      { name: 'In Progress', statusIds: ['2'] },
    ];
    expect(pickColumnForCoarseStatus(columns, 'done')).toBeNull();
  });

  it('builds status labels from column names', () => {
    expect(statusLabelFromColumnName('In Progress')).toBe('in-progress');
    expect(statusLabelFromColumnName('Review')).toBe('review');
  });

  it('picks unambiguous columns for obsidian statuses', () => {
    const columns = [
      { name: 'To Do', statusIds: ['1'] },
      { name: 'In Progress', statusIds: ['2'] },
      { name: 'Review', statusIds: ['3'] },
      { name: 'Done', statusIds: ['4'] },
    ];
    expect(pickColumnForCoarseStatus(columns, 'todo')?.name).toBe('To Do');
    expect(pickColumnForCoarseStatus(columns, 'in_progress')?.name).toBe('In Progress');
    expect(pickColumnForCoarseStatus(columns, 'review')?.name).toBe('Review');
    expect(pickColumnForCoarseStatus(columns, 'done')?.name).toBe('Done');
  });

  it('does not fall back from in_progress onto Review', () => {
    const columns = [
      { name: 'To Do', statusIds: ['1'] },
      { name: 'Review', statusIds: ['3'] },
      { name: 'Done', statusIds: ['4'] },
    ];
    expect(pickColumnForCoarseStatus(columns, 'in_progress')?.name).not.toBe('Review');
    expect(pickColumnForCoarseStatus(columns, 'review')?.name).toBe('Review');
  });

  it('prefers Review over Blocked when picking a review column', () => {
    const columns = [
      { name: 'To Do', statusIds: ['1'] },
      { name: 'Blocked', statusIds: ['blocked'] },
      { name: 'Review', statusIds: ['3'] },
      { name: 'Done', statusIds: ['4'] },
    ];
    expect(pickColumnForCoarseStatus(columns, 'review')?.name).toBe('Review');
  });

  it('infers Done from column even with custom status names', () => {
    expect(
      inferColumnCoarseStatus({ name: 'Done', statusIds: ['custom-done'] }),
    ).toBe('done');
    expect(
      inferColumnCoarseStatus({ name: 'Blocked', statusIds: ['blocked'] }),
    ).toBe('review');
  });

  it('derives remote coarse status from board column membership', () => {
    const issue = {
      id: '1',
      key: 'PROJ-1',
      summary: 'Shipped',
      status: { id: '99', key: 'customDone', display: 'Shipped OK' },
      queue: { key: 'PROJ' },
      tags: [],
    } as TrackerIssue;
    const columns = [
      { name: 'To Do', statusIds: ['open'] },
      { name: 'Done', statusIds: ['customDone', '99'] },
    ];
    expect(toRemoteIssueView(issue, columns).status).toBe('done');
  });

  it('maps review status name even when column looks like in_progress', () => {
    const issue = {
      id: '1',
      key: 'PROJ-2',
      summary: 'Needs eyes',
      status: { id: '5', key: 'review', display: 'In Review', type: 'inProgress' },
      queue: { key: 'PROJ' },
      tags: [],
    } as TrackerIssue;
    const columns = [
      { name: 'To Do', statusIds: ['open'] },
      { name: 'In Progress', statusIds: ['inProgress', 'review', '5'] },
    ];
    expect(toRemoteIssueView(issue, columns).status).toBe('review');
  });
});
