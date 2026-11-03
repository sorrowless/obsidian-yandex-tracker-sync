import { describe, expect, it, vi } from 'vitest';
import { reconcileStatusLabels } from './labels';
import type { TrackerClient } from '../tracker/client';

describe('reconcileStatusLabels', () => {
  const columns = [
    { name: 'To Do', statusIds: ['1'] },
    { name: 'In Progress', statusIds: ['2'] },
    { name: 'Review', statusIds: ['3'] },
    { name: 'Done', statusIds: ['4'] },
  ];

  it('column wins: replaces in-progress with review and keeps non-status labels', async () => {
    const updateIssue = vi.fn(async () => undefined);
    const client = { updateIssue } as unknown as TrackerClient;

    const result = await reconcileStatusLabels(
      client,
      'PROJ-1',
      ['in-progress', 'bug'],
      'Review',
      columns,
      false,
    );

    expect(result.changed).toBe(true);
    expect(result.labels.sort()).toEqual(['bug', 'review'].sort());
    expect(updateIssue).toHaveBeenCalledWith('PROJ-1', { tags: expect.arrayContaining(['review', 'bug']) });
  });

  it('dry-run does not call update', async () => {
    const updateIssue = vi.fn(async () => undefined);
    const client = { updateIssue } as unknown as TrackerClient;
    await reconcileStatusLabels(client, 'PROJ-1', ['in-progress'], 'Review', columns, true);
    expect(updateIssue).not.toHaveBeenCalled();
  });
});
