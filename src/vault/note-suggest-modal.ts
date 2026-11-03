import { App, FuzzySuggestModal, TFile } from 'obsidian';

/** Pick a markdown note; returns the vault-exact path Obsidian uses. */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Select a markdown note…');
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
