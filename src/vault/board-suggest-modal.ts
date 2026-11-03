import { App, FuzzySuggestModal, Notice } from 'obsidian';
import {
  formatBoardOption,
  groupBoardsByQueue,
  type BoardQueueGroup,
} from '../tracker/board-display';
import type { TrackerBoard } from '../tracker/types';

/**
 * Step 1: pick a Tracker queue that has at least one board.
 */
export class BoardQueueSuggestModal extends FuzzySuggestModal<BoardQueueGroup> {
  private readonly groups: BoardQueueGroup[];
  private readonly onChoose: (group: BoardQueueGroup) => void;

  constructor(app: App, boards: TrackerBoard[], onChoose: (group: BoardQueueGroup) => void) {
    super(app);
    this.groups = groupBoardsByQueue(boards);
    this.onChoose = onChoose;
    this.setPlaceholder('Select a Tracker queue…');
  }

  getItems(): BoardQueueGroup[] {
    return this.groups;
  }

  getItemText(group: BoardQueueGroup): string {
    const count = group.boards.length;
    return `${group.label} (${count} board${count === 1 ? '' : 's'})`;
  }

  onChooseItem(group: BoardQueueGroup): void {
    this.onChoose(group);
  }
}

/**
 * Step 2: pick a board within the chosen queue.
 */
export class BoardSuggestModal extends FuzzySuggestModal<TrackerBoard> {
  private readonly boards: TrackerBoard[];
  private readonly onChoose: (board: TrackerBoard) => void;

  constructor(app: App, boards: TrackerBoard[], onChoose: (board: TrackerBoard) => void) {
    super(app);
    this.boards = [...boards].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    this.onChoose = onChoose;
    this.setPlaceholder('Select a Tracker board…');
  }

  getItems(): TrackerBoard[] {
    return this.boards;
  }

  getItemText(board: TrackerBoard): string {
    return formatBoardOption(board);
  }

  onChooseItem(board: TrackerBoard): void {
    this.onChoose(board);
  }
}

/**
 * Open queue → board pickers. If only one queue group exists, skip straight to boards.
 */
export function openBoardPicker(
  app: App,
  boards: TrackerBoard[],
  onChoose: (board: TrackerBoard) => void,
): void {
  if (boards.length === 0) {
    new Notice('Tracker Sync: no boards were returned for this account.');
    return;
  }

  const groups = groupBoardsByQueue(boards);
  const openBoardStep = (groupBoards: TrackerBoard[]) => {
    if (groupBoards.length === 1) {
      const only = groupBoards[0];
      if (only) {
        onChoose(only);
      }
      return;
    }
    new BoardSuggestModal(app, groupBoards, onChoose).open();
  };

  if (groups.length === 1) {
    openBoardStep(groups[0]?.boards ?? []);
    return;
  }

  new BoardQueueSuggestModal(app, boards, (group) => {
    openBoardStep(group.boards);
  }).open();
}
