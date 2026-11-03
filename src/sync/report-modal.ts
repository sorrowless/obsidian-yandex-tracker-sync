import { App, Modal, Setting } from 'obsidian';
import type { SyncRunResult } from './engine';
import { formatSyncReport } from './report';

/** Shows a readable sync / dry-run report, including full error text. */
export class SyncReportModal extends Modal {
  private readonly result: SyncRunResult;

  constructor(app: App, result: SyncRunResult) {
    super(app);
    this.result = result;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', {
      text: this.result.dryRun ? 'Tracker Sync — dry-run report' : 'Tracker Sync — report',
    });

    const pre = contentEl.createEl('pre', {
      cls: 'tracker-sync-report',
      text: formatSyncReport(this.result),
    });
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.userSelect = 'text';
    pre.style.maxHeight = '60vh';
    pre.style.overflow = 'auto';
    pre.style.fontSize = 'var(--font-ui-smaller)';

    new Setting(contentEl).addButton((button) =>
      button.setButtonText('Close').setCta().onClick(() => this.close()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
