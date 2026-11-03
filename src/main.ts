import { Notice, Plugin, TFile, requestUrl } from 'obsidian';
import { TrackerSyncSettingTab } from './settings-tab';
import {
  DEFAULT_SETTINGS,
  isOrgIdHeaderMode,
  isRecencyField,
  isRecencyUnit,
  normalizeMappingPath,
  normalizeRecencyValue,
  orgIdHeaderName,
  prepareMappingsForSave,
  syncIntervalToMilliseconds,
  type PluginSettings,
} from './settings';
import {
  normalizeAssigneeMappings,
  prepareAssigneeMappingsForSave,
  trackerAssigneeDisplayName,
  trackerAssigneeIdentity,
  type KnownTrackerAssignee,
} from './sync/assignee';
import { SyncCoordinator } from './sync/coordinator';
import { syncAllMappings } from './sync/engine';
import { emptyLedger, type LedgerStore, type PendingLink, normalizeLedgerStore } from './sync/ledger';
import { collectSyncErrors, formatSyncNotice } from './sync/report';
import { SyncReportModal } from './sync/report-modal';
import { isTaskStatus } from './sync/status';
import { pathsReferToSameNote, resolveMarkdownFile } from './vault/resolve-note';
import { TrackerClient } from './tracker/client';
import { createObsidianRequestTransport } from './tracker/http';
import { TrackerApiError, type TrackerBoard } from './tracker/types';

interface PluginData {
  settings: PluginSettings;
  ledger: LedgerStore;
  pendingLinks: PendingLink[];
}

const FILE_CHANGE_DEBOUNCE_MS = 10_000;

export default class TrackerSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  ledger: LedgerStore = emptyLedger();
  pendingLinks: PendingLink[] = [];

  private readonly coordinator = new SyncCoordinator();
  private intervalId: number | null = null;
  private readonly fileDebounceTimers = new Map<string, number>();
  /** Paths currently being written by sync — ignore their modify events. */
  private readonly writingPaths = new Set<string>();

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.addCommand({
      id: 'tracker-sync-now',
      name: 'Sync now',
      callback: () => {
        void this.requestSync('manual', this.settings.dryRunDefault);
      },
    });

    this.addCommand({
      id: 'tracker-sync-preview',
      name: 'Preview sync (dry run)',
      callback: () => {
        void this.requestSync('preview', true);
      },
    });

    this.addRibbonIcon('sync', 'Yandex Tracker Sync: Sync now', () => {
      void this.requestSync('ribbon', this.settings.dryRunDefault);
    });

    this.addSettingTab(new TrackerSyncSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') {
          return;
        }
        this.onMappedFileModified(file.path);
      }),
    );

    this.restartScheduler();

    if (this.settings.syncOnStartup) {
      window.setTimeout(() => {
        void this.requestSync('startup', false);
      }, 1_000);
    }
  }

  onunload(): void {
    this.clearIntervalTimer();
    for (const timer of this.fileDebounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.fileDebounceTimers.clear();
  }

  async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as
      | (Partial<PluginData> & Partial<PluginSettings>)
      | null;

    if (raw && typeof raw === 'object' && 'settings' in raw && raw.settings) {
      this.settings = normalizeSettings(raw.settings);
      this.ledger = normalizeLedger(raw.ledger);
      this.pendingLinks = normalizePendingLinks(raw.pendingLinks);
      return;
    }

    this.settings = normalizeSettings(raw ?? {});
    this.ledger = emptyLedger();
    this.pendingLinks = [];
  }

  async saveSettings(): Promise<void> {
    prepareMappingsForSave(this.settings.mappings);
    prepareAssigneeMappingsForSave(this.settings.assigneeMappings);
    await this.savePluginData();
    this.restartScheduler();
  }

  async savePluginData(): Promise<void> {
    const data: PluginData = {
      settings: this.settings,
      ledger: this.ledger,
      pendingLinks: this.pendingLinks,
    };
    await this.saveData(data);
  }

  async clearSyncState(): Promise<number> {
    const cleared = Object.keys(this.ledger.entries).length + this.pendingLinks.length;
    this.ledger = emptyLedger();
    this.pendingLinks = [];
    await this.savePluginData();
    return cleared;
  }

  restartScheduler(): void {
    this.clearIntervalTimer();
    if (!this.settings.syncIntervalEnabled) {
      return;
    }
    const ms = syncIntervalToMilliseconds(
      this.settings.syncIntervalValue,
      this.settings.syncIntervalUnit,
    );
    this.intervalId = window.setInterval(() => {
      void this.requestSync('interval', false);
    }, ms);
  }

  createTrackerClient(): TrackerClient {
    return new TrackerClient({
      apiBaseUrl: this.settings.trackerApiBaseUrl,
      oauthToken: this.settings.oauthToken,
      orgId: this.settings.orgId,
      orgIdHeader: orgIdHeaderName(this.settings.orgIdHeaderMode),
      // requestUrl has no native timeout and can hang forever on a stalled route.
      transport: createObsidianRequestTransport(requestUrl, { timeoutMs: 30_000 }),
    });
  }

  async testTrackerConnection(): Promise<
    { ok: true; displayName: string; boardCount: number } | { ok: false; message: string }
  > {
    try {
      const client = this.createTrackerClient();
      const result = await client.testConnection();
      return { ok: true, displayName: result.displayName, boardCount: result.boardCount };
    } catch (error) {
      return { ok: false, message: formatConnectionError(error) };
    }
  }

  /**
   * Load assignees already present on mapped boards (not the full user directory).
   */
  async refreshKnownAssignees(): Promise<
    { ok: true; count: number } | { ok: false; message: string }
  > {
    const boardIds = [
      ...new Set(
        this.settings.mappings
          .map((mapping) => mapping.boardId)
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (boardIds.length === 0) {
      return { ok: false, message: 'Add at least one board mapping before loading assignees.' };
    }

    try {
      const client = this.createTrackerClient();
      const byId = new Map<string, KnownTrackerAssignee>();
      const boardErrors: string[] = [];
      for (const boardId of boardIds) {
        try {
          const users = await client.listBoardAssignees(boardId);
          for (const user of users) {
            const id = trackerAssigneeIdentity(user);
            if (!id) {
              continue;
            }
            const key = id.toLowerCase();
            if (byId.has(key)) {
              continue;
            }
            byId.set(key, {
              id,
              displayName: trackerAssigneeDisplayName(user) || id,
              login: String(user.login ?? '').trim() || undefined,
            });
          }
        } catch (error) {
          boardErrors.push(
            `board ${boardId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.settings.knownAssignees = [...byId.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
      );
      await this.saveSettings();
      if (this.settings.knownAssignees.length === 0 && boardErrors.length > 0) {
        return { ok: false, message: boardErrors.join('; ') };
      }
      return { ok: true, count: this.settings.knownAssignees.length };
    } catch (error) {
      return { ok: false, message: formatConnectionError(error) };
    }
  }

  async listBoardTags(
    boardId: number,
  ): Promise<{ ok: true; labels: string[] } | { ok: false; message: string }> {
    try {
      const client = this.createTrackerClient();
      const labels = await client.listBoardTags(boardId);
      return { ok: true, labels };
    } catch (error) {
      return { ok: false, message: formatConnectionError(error) };
    }
  }

  /** Alias used by settings tab (labels ≡ tags). */
  async listBoardLabels(
    boardId: number,
  ): Promise<{ ok: true; labels: string[] } | { ok: false; message: string }> {
    return this.listBoardTags(boardId);
  }

  async listBoards(): Promise<
    { ok: true; boards: TrackerBoard[] } | { ok: false; message: string }
  > {
    try {
      const client = this.createTrackerClient();
      const boards = await client.listBoards();
      return { ok: true, boards };
    } catch (error) {
      return { ok: false, message: formatConnectionError(error) };
    }
  }

  async requestSync(reason: string, dryRun: boolean): Promise<void> {
    await this.coordinator.request(reason, dryRun, async (activeReason, activeDryRun) => {
      await this.runSync(activeReason, activeDryRun);
    });
  }

  private async runSync(reason: string, dryRun: boolean): Promise<void> {
    if (!this.settings.oauthToken.trim() || !this.settings.orgId.trim()) {
      new Notice('Tracker Sync: set the OAuth token and organization ID before syncing.');
      return;
    }
    if (this.settings.mappings.length === 0) {
      new Notice('Tracker Sync: add at least one note ↔ board mapping.');
      return;
    }

    let client: TrackerClient;
    try {
      client = this.createTrackerClient();
    } catch (error) {
      new Notice(`Tracker Sync: ${formatConnectionError(error)}`);
      return;
    }

    new Notice(
      dryRun
        ? `Tracker Sync: dry-run starting (${reason})…`
        : `Tracker Sync: starting (${reason})…`,
    );

    try {
      const result = await syncAllMappings(
        this.settings.mappings,
        this.ledger,
        this.pendingLinks,
        {
          siteBaseUrl: this.settings.trackerSiteBaseUrl,
          conflictPolicy: this.settings.conflictPolicy,
          client,
          assigneeMappings: this.settings.assigneeMappings,
          doneResolution: this.settings.doneResolution,
          dryRun,
          readNote: async (path) => {
            const file = resolveMarkdownFile(this.app, path);
            return this.app.vault.read(file);
          },
          writeNote: async (path, content) => {
            const file = resolveMarkdownFile(this.app, path);
            this.writingPaths.add(file.path);
            try {
              await this.app.vault.modify(file, content);
            } finally {
              window.setTimeout(() => {
                this.writingPaths.delete(file.path);
              }, 500);
            }
          },
        },
      );

      if (!dryRun) {
        // Engine mutates ledger + pendingLinks in place for successful mappings.
        await this.savePluginData();
      }

      const errors = collectSyncErrors(result);
      const noticeText = formatSyncNotice(result);
      new Notice(noticeText, errors.length > 0 ? 15_000 : 8_000);

      for (const line of errors) {
        console.error(`Tracker Sync: ${line}`);
      }

      if (dryRun || errors.length > 0) {
        new SyncReportModal(this.app, result).open();
      }
    } catch (error) {
      new Notice(`Tracker Sync failed: ${formatConnectionError(error)}`, 15_000);
      console.error('Tracker Sync failed', error);
    }
  }

  private onMappedFileModified(path: string): void {
    if (!this.settings.syncOnFileChange) {
      return;
    }
    if (this.writingPaths.has(path) || this.coordinator.isRunning) {
      return;
    }
    const mapped = this.settings.mappings.some((mapping) =>
      pathsReferToSameNote(mapping.notePath, path),
    );
    if (!mapped) {
      return;
    }

    const existing = this.fileDebounceTimers.get(path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.fileDebounceTimers.delete(path);
      void this.requestSync('file-change', false);
    }, FILE_CHANGE_DEBOUNCE_MS);
    this.fileDebounceTimers.set(path, timer);
  }

  private clearIntervalTimer(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

function normalizeSettings(saved: Partial<PluginSettings>): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    trackerApiBaseUrl:
      typeof saved.trackerApiBaseUrl === 'string' && saved.trackerApiBaseUrl.trim()
        ? saved.trackerApiBaseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_SETTINGS.trackerApiBaseUrl,
    trackerSiteBaseUrl:
      typeof saved.trackerSiteBaseUrl === 'string' && saved.trackerSiteBaseUrl.trim()
        ? saved.trackerSiteBaseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_SETTINGS.trackerSiteBaseUrl,
    orgIdHeaderMode: isOrgIdHeaderMode(saved.orgIdHeaderMode)
      ? saved.orgIdHeaderMode
      : DEFAULT_SETTINGS.orgIdHeaderMode,
    orgId: typeof saved.orgId === 'string' ? saved.orgId.trim() : '',
    oauthToken: typeof saved.oauthToken === 'string' ? saved.oauthToken.trim() : '',
    doneResolution:
      typeof saved.doneResolution === 'string'
        ? saved.doneResolution.trim()
        : DEFAULT_SETTINGS.doneResolution,
    conflictPolicy:
      saved.conflictPolicy === 'prefer-tracker' || saved.conflictPolicy === 'prefer-obsidian'
        ? saved.conflictPolicy
        : DEFAULT_SETTINGS.conflictPolicy,
    mappings: Array.isArray(saved.mappings)
      ? saved.mappings.map((mapping) => ({
          notePath: normalizeMappingPath(
            typeof mapping?.notePath === 'string' ? mapping.notePath : '',
          ),
          boardId:
            typeof mapping?.boardId === 'number' && Number.isFinite(mapping.boardId)
              ? mapping.boardId
              : 0,
          boardName:
            typeof mapping?.boardName === 'string' && mapping.boardName.trim()
              ? mapping.boardName.trim()
              : undefined,
          labels: Array.isArray(mapping?.labels)
            ? mapping.labels.map((label) => String(label))
            : [],
          queueKey:
            typeof mapping?.queueKey === 'string' ? mapping.queueKey.trim().toUpperCase() : '',
          recencyValue: normalizeRecencyValue(
            typeof mapping?.recencyValue === 'number' ? mapping.recencyValue : 0,
          ),
          recencyUnit: isRecencyUnit(mapping?.recencyUnit) ? mapping.recencyUnit : 'days',
          recencyField: isRecencyField(mapping?.recencyField)
            ? mapping.recencyField
            : 'updated',
        }))
      : [],
    dryRunDefault: Boolean(saved.dryRunDefault),
    assigneeMappings: normalizeAssigneeMappings(
      Array.isArray(saved.assigneeMappings) ? saved.assigneeMappings : [],
    ),
    knownAssignees: Array.isArray(saved.knownAssignees)
      ? saved.knownAssignees
          .map((item) => ({
            id: String((item as KnownTrackerAssignee)?.id ?? '').trim(),
            displayName:
              String((item as KnownTrackerAssignee)?.displayName ?? '').trim() ||
              String((item as KnownTrackerAssignee)?.id ?? '').trim(),
            login: String((item as KnownTrackerAssignee)?.login ?? '').trim() || undefined,
          }))
          .filter((item) => item.id.length > 0)
      : [],
  };
}

function normalizeLedger(raw: LedgerStore | undefined): LedgerStore {
  return normalizeLedgerStore(raw);
}

function normalizePendingLinks(raw: PendingLink[] | undefined): PendingLink[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const legacy = item as PendingLink & { jiraUpdated?: string };
      return {
        mappingKey: String(item.mappingKey ?? ''),
        issueKey: String(item.issueKey ?? '').toUpperCase(),
        title: String(item.title ?? ''),
        description: String(item.description ?? ''),
        status: isTaskStatus(item.status) ? item.status : 'todo',
        parentIssueKey:
          item.parentIssueKey === null || item.parentIssueKey === undefined
            ? null
            : String(item.parentIssueKey).toUpperCase(),
        trackerUpdated: String(legacy.trackerUpdated ?? legacy.jiraUpdated ?? ''),
      };
    })
    .filter((item) => item.mappingKey && item.issueKey);
}

function formatConnectionError(error: unknown): string {
  if (error instanceof TrackerApiError) {
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
