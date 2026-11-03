import { describe, expect, it } from 'vitest';
import {
  formatBoardOption,
  formatBoardSummary,
  groupBoardsByQueue,
} from './board-display';
import type { TrackerBoard } from './types';

function board(
  id: number,
  name: string,
  queueKey?: string,
  queueDisplay?: string,
): TrackerBoard {
  return {
    id,
    name,
    defaultQueue: queueKey
      ? { key: queueKey, display: queueDisplay ?? queueKey, id: String(id) }
      : undefined,
  };
}

describe('board display', () => {
  it('formats board options with queue', () => {
    expect(formatBoardOption(board(3, 'Team', 'DOC', 'Docs'))).toBe('DOC / Team (#3)');
    expect(formatBoardSummary(board(3, 'Team', 'DOC'))).toBe('DOC / Team');
  });

  it('groups boards by default queue', () => {
    const groups = groupBoardsByQueue([
      board(1, 'A', 'OPS'),
      board(2, 'B', 'DOC'),
      board(3, 'C', 'OPS'),
      board(4, 'Orphan'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['DOC', 'OPS', '__other__']);
    expect(groups.find((g) => g.key === 'OPS')?.boards.map((b) => b.id)).toEqual([1, 3]);
  });
});
