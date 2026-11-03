import { App, FuzzySuggestModal, Notice } from 'obsidian';

/**
 * Pick a label already seen on the board. Custom / future labels are typed
 * in the mapping’s comma-separated field instead.
 */
export class LabelSuggestModal extends FuzzySuggestModal<string> {
  private readonly suggestions: string[];
  private readonly onChoose: (label: string) => void;

  constructor(app: App, suggestions: string[], onChoose: (label: string) => void) {
    super(app);
    this.suggestions = [...suggestions].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
    this.onChoose = onChoose;
    this.setPlaceholder('Select a label from this board…');
  }

  getItems(): string[] {
    return this.suggestions;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }

  onNoSuggestion(): void {
    new Notice('No matching board labels. Type a custom label in the Labels field.');
  }
}
