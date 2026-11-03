import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TrackerSyncPlugin from './main';
import {
  createEmptyMapping,
  isMappingBlank,
  isMappingComplete,
  isRecencyField,
  isRecencyUnit,
  normalizeRecencyValue,
  normalizeSyncIntervalValue,
  type ConflictPolicy,
  type NoteBoardMapping,
  type OrgIdHeaderMode,
  type SyncIntervalUnit,
} from './settings';
import type { AssigneeMapping } from './sync/assignee';
import {
  formatLabelList,
  normalizeMappingLabels,
  parseLabelListInput,
} from './sync/label-filter';
import { formatBoardSummary } from './tracker/board-display';
import { openBoardPicker } from './vault/board-suggest-modal';
import { LabelSuggestModal } from './vault/label-suggest-modal';
import { NoteSuggestModal } from './vault/note-suggest-modal';
import { resolveMarkdownFile } from './vault/resolve-note';

export class TrackerSyncSettingTab extends PluginSettingTab {
  plugin: TrackerSyncPlugin;

  constructor(app: App, plugin: TrackerSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Yandex Tracker Sync' });
    containerEl.createEl('p', {
      text: 'Configure connection, note ↔ board mappings, conflict policy, and sync triggers. Commands: Sync now, Preview sync (dry run). Ribbon button also starts sync.',
    });

    this.renderConnectionSection(containerEl);
    this.renderAssigneeMappingsSection(containerEl);
    this.renderMappingsSection(containerEl);
    this.renderConflictSection(containerEl);
    this.renderTriggersSection(containerEl);
    this.renderMaintenanceSection(containerEl);
  }

  private renderConnectionSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Connection' });

    new Setting(containerEl)
      .setName('API base URL')
      .setDesc('Tracker API host. Default: https://api.tracker.yandex.net')
      .addText((text) =>
        text
          .setPlaceholder('https://api.tracker.yandex.net')
          .setValue(this.plugin.settings.trackerApiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.trackerApiBaseUrl = value.trim().replace(/\/+$/, '');
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Site base URL')
      .setDesc('Frontend host written into note links. Default: https://tracker.yandex.ru')
      .addText((text) =>
        text
          .setPlaceholder('https://tracker.yandex.ru')
          .setValue(this.plugin.settings.trackerSiteBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.trackerSiteBaseUrl = value.trim().replace(/\/+$/, '');
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Organization header')
      .setDesc(
        'X-Org-ID for Yandex 360 for Business; X-Cloud-Org-ID for Yandex Identity Hub / Cloud organizations.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('org', 'X-Org-ID (Yandex 360)')
          .addOption('cloud-org', 'X-Cloud-Org-ID (Cloud)')
          .setValue(this.plugin.settings.orgIdHeaderMode)
          .onChange(async (value) => {
            this.plugin.settings.orgIdHeaderMode = value as OrgIdHeaderMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Organization ID')
      .setDesc('Copied from Administration → Organizations in Tracker')
      .addText((text) =>
        text
          .setPlaceholder('Organization ID')
          .setValue(this.plugin.settings.orgId)
          .onChange(async (value) => {
            this.plugin.settings.orgId = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('OAuth token')
      .setDesc('OAuth 2.0 token with Tracker access (Authorization: OAuth …)')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Token')
          .setValue(this.plugin.settings.oauthToken)
          .onChange(async (value) => {
            this.plugin.settings.oauthToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Done resolution')
      .setDesc(
        'Resolution key sent when transitioning into a done-family status (e.g. fixed). Leave empty to omit.',
      )
      .addText((text) =>
        text
          .setPlaceholder('fixed')
          .setValue(this.plugin.settings.doneResolution)
          .onChange(async (value) => {
            this.plugin.settings.doneResolution = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Calls GET /v3/myself (auth check only; does not list boards)')
      .addButton((button) =>
        button.setButtonText('Test connection').onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('Testing…');
          try {
            const result = await this.plugin.testTrackerConnection();
            if (result.ok) {
              new Notice(`Tracker Sync: connection OK (${result.displayName}).`);
            } else {
              new Notice(`Tracker Sync: connection failed — ${result.message}`, 15_000);
              console.error('Tracker Sync: connection failed', result.message);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Tracker Sync: connection failed — ${message}`, 15_000);
            console.error('Tracker Sync: connection failed', error);
          } finally {
            button.setButtonText('Test connection');
            button.setDisabled(false);
          }
        }),
      );

    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Dates: 🛫 ↔ start, 📅 writes to deadline (end wins on pull when set). Time spent is pulled from spent (milliseconds → [timespent:: seconds]); Obsidian never writes worklogs.',
    });
  }

  private renderAssigneeMappingsSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Assignee mappings' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Map Tracker assignees (seen on your boards) to Dataview fields like [assignee:: Аряпов]. Open tasks sync assignee both ways; when values differ Obsidian wins. Done↔done tasks are skipped. Unmapped users are ignored.',
    });

    new Setting(containerEl)
      .setName('Load assignees from boards')
      .setDesc(
        'Collect users already assigned on mapped boards (not the full Tracker directory). Required before the dropdowns are useful.',
      )
      .addButton((button) =>
        button.setButtonText('Refresh assignees').onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await this.plugin.refreshKnownAssignees();
            if (!result.ok) {
              new Notice(`Tracker Sync: ${result.message}`);
              return;
            }
            new Notice(`Tracker Sync: loaded ${result.count} assignee(s) from boards.`);
            this.display();
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    const known = this.plugin.settings.knownAssignees ?? [];
    if (known.length === 0) {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'No board assignees cached yet. Add note↔board mappings, then click Refresh assignees.',
      });
    }

    const rows = this.plugin.settings.assigneeMappings ?? [];
    rows.forEach((row, index) => {
      new Setting(containerEl)
        .setName(`Assignee ${index + 1}`)
        .setDesc('Tracker user → Obsidian Dataview value')
        .addDropdown((dropdown) => {
          dropdown.addOption('', '— select Tracker user —');
          for (const user of known) {
            dropdown.addOption(user.id, user.displayName);
          }
          if (row.trackerUserId && !known.some((user) => user.id === row.trackerUserId)) {
            dropdown.addOption(
              row.trackerUserId,
              row.trackerDisplayName || row.trackerUserId,
            );
          }
          dropdown.setValue(row.trackerUserId || '');
          dropdown.onChange(async (value) => {
            const current = this.plugin.settings.assigneeMappings[index];
            if (!current) {
              return;
            }
            const match =
              known.find((user) => user.id === value) ??
              (value
                ? {
                    id: value,
                    displayName: current.trackerDisplayName || value,
                    login: current.trackerLogin,
                  }
                : null);
            current.trackerUserId = match?.id ?? '';
            current.trackerDisplayName = match?.displayName ?? '';
            current.trackerLogin = match?.login;
            await this.plugin.saveSettings();
          });
        })
        .addText((text) =>
          text
            .setPlaceholder('Аряпов')
            .setValue(row.obsidianValue)
            .onChange(async (value) => {
              const current = this.plugin.settings.assigneeMappings[index];
              if (!current) {
                return;
              }
              current.obsidianValue = value;
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((button) => {
          button
            .setIcon('trash')
            .setTooltip('Remove assignee mapping')
            .onClick(async () => {
              this.plugin.settings.assigneeMappings.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    });

    new Setting(containerEl).addButton((button) =>
      button.setButtonText('Add assignee mapping').onClick(async () => {
        const blank: AssigneeMapping = {
          trackerUserId: '',
          trackerDisplayName: '',
          obsidianValue: '',
        };
        this.plugin.settings.assigneeMappings.push(blank);
        await this.plugin.savePluginData();
        this.display();
      }),
    );
  }

  private renderMappingsSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Note ↔ board mappings' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Each mapping pairs one vault note with one Tracker board. Prefer Browse note / Browse board. Optional Tags filter the board (OR match). Leave Tags empty to sync every issue on the board. New issues use the Queue key when set, otherwise the board default queue.',
    });

    this.plugin.settings.mappings.forEach((mapping, index) => {
      new Setting(containerEl)
        .setName(`Mapping ${index + 1} — note`)
        .setDesc('Vault-relative note path — prefer Browse note for the exact Obsidian path')
        .addText((text) =>
          text
            .setPlaceholder('Folder/My tasks.md')
            .setValue(mapping.notePath)
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              current.notePath = value;
              await this.plugin.saveSettings();
            }),
        )
        .addButton((button) =>
          button.setButtonText('Browse note').onClick(() => {
            new NoteSuggestModal(this.app, (file) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              current.notePath = file.path;
              void this.plugin.saveSettings().then(() => this.display());
            }).open();
          }),
        )
        .addExtraButton((button) => {
          button
            .setIcon('trash')
            .setTooltip('Remove mapping')
            .onClick(async () => {
              this.plugin.settings.mappings.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });

      const boardDesc = mapping.boardName
        ? `Selected: ${mapping.boardName} (id ${mapping.boardId}). Browse board picks queue, then board.`
        : 'Numeric board id. Prefer Browse board: pick queue, then board.';

      new Setting(containerEl)
        .setName(`Mapping ${index + 1} — board`)
        .setDesc(boardDesc)
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text
            .setPlaceholder('Board id')
            .setValue(mapping.boardId > 0 ? String(mapping.boardId) : '')
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              const parsed = Number.parseInt(value, 10);
              const nextId = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
              if (current.boardId !== nextId) {
                current.boardName = undefined;
              }
              current.boardId = nextId;
              await this.plugin.saveSettings();
            });
        })
        .addButton((button) =>
          button.setButtonText('Browse board').onClick(async () => {
            button.setDisabled(true);
            button.setButtonText('Loading…');
            try {
              const result = await this.plugin.listBoards();
              if (!result.ok) {
                new Notice(`Tracker Sync: ${result.message}`, 15_000);
                console.error('Tracker Sync: listBoards failed', result.message);
                return;
              }
              if (result.boards.length === 0) {
                new Notice(
                  'Tracker Sync: no boards returned. Check org header (X-Org-ID vs X-Cloud-Org-ID) and that the token can see boards.',
                  12_000,
                );
                return;
              }
              openBoardPicker(this.app, result.boards, (board) => {
                const queueKey = board.defaultQueue?.key?.trim().toUpperCase() ?? '';
                void this.applyBoardToMapping(
                  index,
                  board.id,
                  formatBoardSummary(board),
                  queueKey,
                );
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(`Tracker Sync: ${message}`, 15_000);
              console.error('Tracker Sync: Browse board failed', error);
            } finally {
              button.setButtonText('Browse board');
              button.setDisabled(false);
            }
          }),
        );

      new Setting(containerEl)
        .setName(`Mapping ${index + 1} — queue key`)
        .setDesc(
          'Queue for new issues created from Obsidian. Empty = board default queue. Filled automatically when you Browse board.',
        )
        .addText((text) =>
          text
            .setPlaceholder('DOC')
            .setValue(mapping.queueKey ?? '')
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              current.queueKey = value.trim().toUpperCase();
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName(`Mapping ${index + 1} — tags`)
        .setDesc(
          'Comma-separated Tracker tags (OR). Empty = all board issues. Type future tags here, or pick ones already on the board.',
        )
        .addText((text) =>
          text
            .setPlaceholder('project-a, backend')
            .setValue(formatLabelList(mapping.labels ?? []))
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              current.labels = parseLabelListInput(value);
              await this.plugin.saveSettings();
            }),
        )
        .addButton((button) =>
          button.setButtonText('Add from board').onClick(async () => {
            const current = this.plugin.settings.mappings[index];
            if (!current || !(current.boardId > 0)) {
              new Notice('Tracker Sync: choose a board before loading tags.');
              return;
            }
            button.setDisabled(true);
            try {
              const result = await this.plugin.listBoardLabels(current.boardId);
              if (!result.ok) {
                new Notice(`Tracker Sync: ${result.message}`);
                return;
              }
              if (result.labels.length === 0) {
                new Notice(
                  'Tracker Sync: no tags found on board issues. Type a tag in the field.',
                );
                return;
              }
              new LabelSuggestModal(this.app, result.labels, (label) => {
                void this.addLabelToMapping(index, label);
              }).open();
            } finally {
              button.setDisabled(false);
            }
          }),
        );

      new Setting(containerEl)
        .setName(`Mapping ${index + 1} — recent only`)
        .setDesc(
          'Limit to issues updated or created in the last N days/months. 0 = no limit.',
        )
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '0';
          text.inputEl.step = '1';
          text
            .setPlaceholder('0')
            .setValue(String(mapping.recencyValue ?? 0))
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              const parsed = Number.parseInt(value, 10);
              current.recencyValue = normalizeRecencyValue(
                Number.isFinite(parsed) ? parsed : 0,
              );
              await this.plugin.saveSettings();
            });
        })
        .addDropdown((dropdown) =>
          dropdown
            .addOption('days', 'Days')
            .addOption('months', 'Months')
            .setValue(mapping.recencyUnit ?? 'days')
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current || !isRecencyUnit(value)) {
                return;
              }
              current.recencyUnit = value;
              await this.plugin.saveSettings();
            }),
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption('updated', 'Updated')
            .addOption('created', 'Created')
            .setValue(mapping.recencyField ?? 'updated')
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current || !isRecencyField(value)) {
                return;
              }
              current.recencyField = value;
              await this.plugin.saveSettings();
            }),
        );

      if (!isMappingBlank(mapping) && !isMappingComplete(mapping)) {
        containerEl.createEl('p', {
          cls: 'setting-item-description',
          text: `Mapping ${index + 1} is incomplete — both note and board are required before sync.`,
        });
      } else if (isMappingComplete(mapping)) {
        try {
          const file = resolveMarkdownFile(this.app, mapping.notePath);
          if (file.path !== mapping.notePath) {
            containerEl.createEl('p', {
              cls: 'setting-item-description',
              text: `Resolved to vault path “${file.path}”. Click Browse note once to store that exact path.`,
            });
          }
        } catch {
          containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: `Mapping ${index + 1}: note not found in the vault. Use Browse note to select it.`,
          });
        }
      }
    });

    new Setting(containerEl).addButton((button) =>
      button.setButtonText('Add mapping').onClick(async () => {
        this.plugin.settings.mappings.push(createEmptyMapping());
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }

  private async applyBoardToMapping(
    index: number,
    boardId: number,
    boardName: string,
    queueKey: string,
  ): Promise<void> {
    const current = this.plugin.settings.mappings[index];
    if (!current) {
      return;
    }
    current.boardId = boardId;
    current.boardName = boardName;
    if (queueKey && !current.queueKey) {
      current.queueKey = queueKey;
    }
    await this.plugin.saveSettings();
    new Notice(`Tracker Sync: board set to ${boardName} (#${boardId}).`);
    this.display();
  }

  private async addLabelToMapping(index: number, label: string): Promise<void> {
    const current = this.plugin.settings.mappings[index] as NoteBoardMapping | undefined;
    if (!current) {
      return;
    }
    current.labels = normalizeMappingLabels([...(current.labels ?? []), label]);
    await this.plugin.saveSettings();
    this.display();
  }

  private renderConflictSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Conflict policy' });

    new Setting(containerEl)
      .setName('When both sides changed')
      .setDesc('Used when a linked task differs from the last sync on both Obsidian and Tracker')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('prefer-obsidian', 'Prefer Obsidian')
          .addOption('prefer-tracker', 'Prefer Tracker')
          .setValue(this.plugin.settings.conflictPolicy)
          .onChange(async (value) => {
            this.plugin.settings.conflictPolicy = value as ConflictPolicy;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderTriggersSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Sync triggers' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The Sync now command is always available. These options are independent.',
    });

    new Setting(containerEl)
      .setName('Sync on startup')
      .setDesc('Run once after the plugin loads')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Sync on interval')
      .setDesc('Run periodically while Obsidian is open')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncIntervalEnabled)
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalEnabled = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Interval value')
      .setDesc('Minimum 1. Combined with the unit below')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text
          .setValue(String(this.plugin.settings.syncIntervalValue))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.syncIntervalValue = normalizeSyncIntervalValue(parsed);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Interval unit')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('minutes', 'Minutes')
          .addOption('hours', 'Hours')
          .setValue(this.plugin.settings.syncIntervalUnit)
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalUnit = value as SyncIntervalUnit;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Sync on file change')
      .setDesc('After editing a mapped note, wait 10 seconds from the last change, then sync')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnFileChange)
          .onChange(async (value) => {
            this.plugin.settings.syncOnFileChange = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Dry-run by default')
      .setDesc(
        'When enabled, Sync now / ribbon only preview changes. Automatic triggers always perform a real sync.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dryRunDefault).onChange(async (value) => {
          this.plugin.settings.dryRunDefault = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderMaintenanceSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Maintenance' });

    const entryCount = Object.keys(this.plugin.ledger.entries).length;
    const pendingCount = this.plugin.pendingLinks.length;

    new Setting(containerEl)
      .setName('Clear sync state')
      .setDesc(
        `Forget the sync ledger and pending links (${entryCount} ledger entr${entryCount === 1 ? 'y' : 'ies'}, ${pendingCount} pending). Connection settings and mappings stay.`,
      )
      .addButton((button) =>
        button
          .setButtonText('Clear sync state')
          .setWarning()
          .onClick(async () => {
            const confirmed = window.confirm(
              'Clear Tracker Sync state?\n\n' +
                'This deletes the local sync ledger and pending links. ' +
                'Mapped notes and Tracker issues are not deleted. ' +
                'The next sync will treat remote issues as new imports.',
            );
            if (!confirmed) {
              return;
            }
            const cleared = await this.plugin.clearSyncState();
            new Notice(
              cleared > 0
                ? `Tracker Sync: cleared sync state (${cleared} record${cleared === 1 ? '' : 's'}).`
                : 'Tracker Sync: sync state was already empty.',
            );
            this.display();
          }),
      );
  }
}
