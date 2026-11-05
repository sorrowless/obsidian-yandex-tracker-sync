import { parseNoteTasks } from '../note/parser';
import type { ParsedTaskNode } from '../note/types';
import type { TrackerClient } from '../tracker/client';
import { describeIssueSyncFilter } from '../tracker/issue-filter';
import { buildRecencyClause, type RecencyField, type RecencyUnit } from '../tracker/query';
import type { TrackerIssue } from '../tracker/types';
import { extractIssueKeyFromUrl } from '../tracker/urls';
import {
  mappingRecencyFilter,
  type ConflictPolicy,
} from '../settings';
import {
  emptyActions,
  type SyncActionDetail,
} from './actions';
import {
  decideAssigneeReconcile,
  findMappingByObsidianValue,
  normalizeAssigneeMappings,
  toTrackerAssigneeValue,
  type AssigneeMapping,
} from './assignee';
import { buildTrackerDatePayload } from './issue-dates';
import {
  mergeMappingLabels,
  normalizeMappingLabels,
} from './label-filter';
import { decideTimeSpentReconcile } from './timespent';
import { reconcileStatusLabels, desiredStatusLabel } from './labels';
import {
  cloneLedger,
  commitMappingLedger,
  contentCoreEqual,
  contentSnapshot,
  descriptionFromLines,
  descriptionToLines,
  ledgerEntryKey,
  makeLedgerEntry,
  mappingKey,
  normalizeDescription,
  snapshotFromLedger,
  syncCalendarDay,
  type ContentSnapshot,
  type LedgerEntry,
  type LedgerStore,
  type PendingLink,
} from './ledger';
import {
  columnsFromBoardConfig,
  indexRemoteIssues,
  toRemoteIssueView,
  type RemoteIssueView,
} from './remote';
import {
  pickColumnForCoarseStatus,
  type BoardColumnView,
  type TaskStatus,
} from './status';
import {
  applyRootReplacements,
  checkboxCharForStatus,
  renderTask,
  type RenderableTask,
} from './writer';

export interface SyncMapping {
  notePath: string;
  boardId: number;
  /** Tracker tag filter: empty = all board issues; otherwise OR-match any listed tag. */
  labels?: string[];
  /** Optional queue key for creating new issues (empty = board defaultQueue). */
  queueKey?: string;
  /** Optional recency window (`0` / omit = no limit). */
  recencyValue?: number;
  recencyUnit?: RecencyUnit;
  recencyField?: RecencyField;
}

export interface SyncEngineOptions {
  /** Tracker frontend site used for note links (settings.trackerSiteBaseUrl). */
  siteBaseUrl: string;
  conflictPolicy: ConflictPolicy;
  client: TrackerClient;
  /** Tracker ↔ Obsidian Dataview assignee mappings. */
  assigneeMappings?: AssigneeMapping[];
  /** Resolution key sent when transitioning into a done-family status (empty = omit). */
  doneResolution?: string;
  readNote: (path: string) => Promise<string>;
  writeNote: (path: string, content: string) => Promise<void>;
  /** When true, list remotes but do not mutate Tracker, notes, or the real ledger. */
  dryRun?: boolean;
  now?: () => string;
}

export interface MappingSyncCounts {
  createdRemote: number;
  createdLocal: number;
  pushed: number;
  pulled: number;
  conflictsResolved: number;
  unchanged: number;
  unresolvedRemovals: number;
  recoveredPendingLinks: number;
  duplicateSkips: number;
  labelReconciliations: number;
  assigneeReconciliations: number;
  timeSpentReconciliations: number;
}

export interface MappingSyncResult {
  notePath: string;
  boardId: number;
  /** Normalized filter tags used for this run (empty = whole board). */
  labels: string[];
  /** Recency filter used for this run, or null when disabled. */
  recency: { field: RecencyField; value: number; unit: RecencyUnit } | null;
  counts: MappingSyncCounts;
  /** Per-task actions for informative dry-run / sync reports. */
  actions: SyncActionDetail[];
  errors: string[];
  unresolvedIssueKeys: string[];
  /** Creates that reached Tracker but could not be written into the note. */
  pendingLinks: PendingLink[];
}

export interface SyncRunResult {
  mappings: MappingSyncResult[];
  message: string;
  dryRun: boolean;
}

export type { SyncActionDetail } from './actions';

interface MutableTask {
  lineIndex: number | null;
  endLineIndex: number | null;
  indent: string;
  listMarker: string;
  checkboxChar: string;
  status: TaskStatus | null;
  title: string;
  descriptionLines: string[];
  issueKey: string | null;
  /** Leading title-link URL (Tracker or external), or null for plain titles. */
  titleLinkUrl: string | null;
  /** Key from `[ytracker::]` when in dual-link mode. */
  ytrackerIssueKey: string | null;
  /** Unknown Dataview `[key:: value]` segments preserved on rewrite. */
  unknownInlineFields: string[];
  startDate: string | null;
  dueDate: string | null;
  assignee: string | null;
  timeSpentSeconds: number | null;
  children: MutableTask[];
  parent: MutableTask | null;
  isNew: boolean;
  dirty: boolean;
}

interface MappingContext {
  columns: BoardColumnView[];
  /** Queue key used when creating issues (mapping.queueKey || board.defaultQueue.key). */
  queueKey: string;
  /** Tracker status metadata keyed by status key/id (for coarse status inference). */
  statusMeta: Map<string, { name: string; type?: string }>;
  /** Normalized OR-filter tags for this mapping (empty = all issues). */
  filterLabels: string[];
  assigneeMappings: AssigneeMapping[];
  doneResolution: string;
}

let fakeIssueCounter = 0;

export async function syncAllMappings(
  mappings: SyncMapping[],
  ledger: LedgerStore,
  pendingLinks: PendingLink[],
  options: SyncEngineOptions,
): Promise<SyncRunResult> {
  const results: MappingSyncResult[] = [];
  const dryRun = options.dryRun === true;
  const nextPending = [...pendingLinks];

  for (const mapping of mappings) {
    const notePath = normalizeNotePath(mapping.notePath);
    const boardId = mapping.boardId;
    const labels = normalizeMappingLabels(mapping.labels);
    const recency = mappingRecencyFilter(mapping);

    if (!notePath && !(boardId > 0)) {
      continue;
    }

    if (!notePath || boardId <= 0) {
      results.push({
        notePath,
        boardId,
        labels: [],
        recency: null,
        counts: emptyCounts(),
        actions: emptyActions(),
        errors: [
          !notePath && boardId > 0
            ? `Mapping is incomplete: note path is missing (board id ${boardId})`
            : `Mapping is incomplete: board id is missing (note path "${notePath}")`,
        ],
        unresolvedIssueKeys: [],
        pendingLinks: [],
      });
      continue;
    }

    try {
      const result = await syncOneMapping(
        {
          notePath,
          boardId,
          labels,
          queueKey: mapping.queueKey,
          recencyValue: mapping.recencyValue,
          recencyUnit: mapping.recencyUnit,
          recencyField: mapping.recencyField,
        },
        ledger,
        nextPending,
        { ...options, dryRun },
      );
      results.push(result);

      const key = mappingKey(notePath, boardId, labels);
      for (let i = nextPending.length - 1; i >= 0; i -= 1) {
        if (nextPending[i]?.mappingKey === key) {
          nextPending.splice(i, 1);
        }
      }
      if (!dryRun) {
        nextPending.push(...result.pendingLinks);
      }
    } catch (error) {
      results.push({
        notePath,
        boardId,
        labels,
        recency,
        counts: emptyCounts(),
        actions: emptyActions(),
        errors: [errorMessage(error)],
        unresolvedIssueKeys: [],
        pendingLinks: [],
      });
    }
  }

  pendingLinks.splice(0, pendingLinks.length, ...nextPending);

  const errorCount = results.reduce((sum, item) => sum + item.errors.length, 0);
  const totals = results.reduce((acc, item) => addCounts(acc, item.counts), emptyCounts());
  const allActions = results.flatMap((item) => item.actions);

  return {
    mappings: results,
    dryRun,
    message: summarizeRun(totals, errorCount, mappings.length, dryRun, allActions),
  };
}

export async function syncOneMapping(
  mapping: SyncMapping,
  ledger: LedgerStore,
  pendingLinks: PendingLink[],
  options: SyncEngineOptions,
): Promise<MappingSyncResult> {
  const counts = emptyCounts();
  const actions = emptyActions();
  const errors: string[] = [];
  const unresolvedKeys: string[] = [];
  const createdPending: PendingLink[] = [];
  const now = options.now ?? (() => new Date().toISOString());
  const dryRun = options.dryRun === true;
  const filterLabels = normalizeMappingLabels(mapping.labels);
  const recency = mappingRecencyFilter(mapping);
  const key = mappingKey(mapping.notePath, mapping.boardId, filterLabels);
  const workingLedger = cloneLedger(ledger);

  const markdown = await options.readNote(mapping.notePath);
  const parsed = parseNoteTasks(markdown, { trackerSiteBaseUrl: options.siteBaseUrl });
  const roots = parsed.map((node) => fromParsed(node, null));

  let ctx: MappingContext;
  try {
    ctx = await loadMappingContext(
      options.client,
      mapping.boardId,
      mapping.queueKey,
      filterLabels,
      options.assigneeMappings,
      options.doneResolution,
    );
  } catch (error) {
    return {
      notePath: mapping.notePath,
      boardId: mapping.boardId,
      labels: filterLabels,
      recency,
      counts,
      actions,
      errors: [errorMessage(error)],
      unresolvedIssueKeys: [],
      pendingLinks: [],
    };
  }

  if (!ctx.queueKey) {
    errors.push(
      `Board ${mapping.boardId} has no default queue and the mapping has no queue key; cannot create issues`,
    );
  }

  const syncFilter = {
    tags: filterLabels,
    recency,
    queueKey: ctx.queueKey || undefined,
  };

  let remoteMap = new Map<string, RemoteIssueView>();
  try {
    // Tag/recency filtering is applied inside the client (Tracker query).
    const fetched = await options.client.listBoardIssuesForSync(
      mapping.boardId,
      syncFilter,
    );
    const indexed = indexRemoteIssues(fetched, ctx.columns, { statusMeta: ctx.statusMeta });
    remoteMap = indexed.remoteMap;
  } catch (error) {
    errors.push(errorMessage(error));
  }

  const hasActiveFilter =
    filterLabels.length > 0 || Boolean(recency && buildRecencyClause(recency));
  if (hasActiveFilter && remoteMap.size === 0 && errors.length === 0) {
    errors.push(
      `No Tracker issues matched ${describeIssueSyncFilter(syncFilter)} for board ${mapping.boardId}. ` +
        'Confirm the tag spelling, recency window, and that issues are on the board.',
    );
  }

  const localByKey = new Map<string, MutableTask>();
  const localOrder: MutableTask[] = [];
  walkMutable(roots, (task) => {
    localOrder.push(task);
    if (task.issueKey !== null) {
      const issueKey = task.issueKey.toUpperCase();
      // First occurrence wins: later checklist rows that reuse the same
      // Tracker key (common with dual-link / copied Jira lines) must not
      // overwrite the canonical local view used for parent lookup + sync.
      if (!localByKey.has(issueKey)) {
        localByKey.set(issueKey, task);
      }
    }
  });

  // Board listing is often incomplete (sprint-only queries / pagination). Hydrate
  // every linked key missing from the board payload before conflict resolution.
  const missingLinkedKeys = [...localByKey.keys()].filter((key) => !remoteMap.has(key));
  const hydrateErrors = new Map<string, string>();
  if (missingLinkedKeys.length > 0 && !dryRun) {
    try {
      const hydrated = await options.client.findIssuesByKeys(missingLinkedKeys);
      for (const [issueKey, issue] of hydrated) {
        const view = toRemoteIssueView(issue, ctx.columns, { statusMeta: ctx.statusMeta });
        remoteMap.set(issueKey, view);
      }
      for (const issueKey of missingLinkedKeys) {
        if (!remoteMap.has(issueKey)) {
          hydrateErrors.set(
            issueKey,
            'not returned by Key: search or GET /issues/{key}',
          );
        }
      }
    } catch (error) {
      for (const issueKey of missingLinkedKeys) {
        if (!remoteMap.has(issueKey)) {
          hydrateErrors.set(issueKey, errorMessage(error));
        }
      }
    }
  }

  const mappingPending = pendingLinks.filter((item) => item.mappingKey === key);
  const syncedIssueKeys = new Set<string>();

  for (const local of localOrder) {
    const parentIssueKey = local.parent?.issueKey?.toUpperCase() ?? null;

    if (local.issueKey === null) {
      const recovered = takePendingMatch(mappingPending, local.title, parentIssueKey);
      if (recovered) {
        const issueKey = recovered.issueKey.toUpperCase();
        if (syncedIssueKeys.has(issueKey)) {
          counts.duplicateSkips += 1;
          actions.push({
            kind: 'duplicate-skip',
            title: local.title,
            issueKey,
            detail:
              'pending relink skipped; another checklist line already syncs this Tracker key',
          });
          continue;
        }
        local.issueKey = issueKey;
        if (isExternalTitleLink(local, options.siteBaseUrl)) {
          local.ytrackerIssueKey = issueKey;
        }
        local.dirty = true;
        markRootDirty(local);
        if (!localByKey.has(issueKey)) {
          localByKey.set(issueKey, local);
        }
        syncedIssueKeys.add(issueKey);
        writeLedgerFromLocal(
          workingLedger,
          key,
          issueKey,
          local,
          parentIssueKey,
          recovered.status,
          recovered.trackerUpdated,
          '',
          '',
          now,
        );
        counts.recoveredPendingLinks += 1;
        counts.createdRemote += 1;
        actions.push({
          kind: 'recovered-pending',
          title: local.title,
          issueKey,
          detail: 'relink previously created Tracker issue that was not yet written into the note',
        });
        continue;
      }

      if (!ctx.queueKey) {
        errors.push(`Create remote "${local.title}": queue key is unknown`);
        continue;
      }

      const external = isExternalTitleLink(local, options.siteBaseUrl);

      // Dual-link: try to bind an existing Tracker issue by exact summary first.
      if (external && !dryRun) {
        try {
          const matched = await options.client.findIssueByExactSummary(
            ctx.queueKey,
            local.title,
          );
          if (matched) {
            const view = toRemoteIssueView(matched, ctx.columns, {
              statusMeta: ctx.statusMeta,
            });
            if (syncedIssueKeys.has(view.key)) {
              counts.duplicateSkips += 1;
              actions.push({
                kind: 'duplicate-skip',
                title: local.title,
                issueKey: view.key,
                detail:
                  'bind-by-title skipped; another checklist line already syncs this Tracker key',
              });
              continue;
            }
            local.issueKey = view.key;
            local.ytrackerIssueKey = view.key;
            local.dirty = true;
            markRootDirty(local);
            if (!localByKey.has(view.key)) {
              localByKey.set(view.key, local);
            }
            syncedIssueKeys.add(view.key);
            remoteMap.set(view.key, view);
            writeLedgerFromRemote(workingLedger, key, view, now);
            counts.createdRemote += 1;
            actions.push({
              kind: 'create-remote',
              title: local.title,
              issueKey: view.key,
              detail: 'bound existing Tracker issue by title; wrote [ytracker::] field',
            });
            continue;
          }
        } catch (error) {
          errors.push(
            `Bind by summary "${local.title}": ${errorMessage(error)}`,
          );
        }
      }

      try {
        const status = local.status ?? 'todo';
        const targetColumn = pickColumnForCoarseStatus(
          ctx.columns,
          status,
          ctx.statusMeta,
        );
        const initialLabels: string[] = mergeMappingLabels([], filterLabels);
        if (targetColumn) {
          const label = desiredStatusLabel(targetColumn.name);
          if (label) {
            initialLabels.push(label);
          }
        }

        const created = dryRun
          ? fakeCreatedIssue(local, ctx.queueKey, status, targetColumn, now(), initialLabels)
          : await createRemoteIssue(
              options.client,
              ctx,
              local,
              parentIssueKey,
              initialLabels,
            );

        if (!dryRun && status !== 'todo') {
          if (!targetColumn) {
            errors.push(
              `Transition ${created.key}: no board column mapped for status "${status}"`,
            );
          } else {
            // The issue already exists: a failed transition must not lose the link.
            try {
              const moved = await transitionToColumn(
                options.client,
                created.key,
                targetColumn,
                status,
                created.trackerStatusId,
                ctx.doneResolution,
                false,
              );
              if (moved) {
                const refreshed = await options.client.getIssue(created.key);
                const view = toRemoteIssueView(refreshed, ctx.columns, {
                  statusMeta: ctx.statusMeta,
                });
                if (view.status !== status) {
                  throw new Error(
                    `finished in "${view.trackerStatusName}" (${view.status}), expected ${status}`,
                  );
                }
                Object.assign(created, view, {
                  parentIssueKey: parentIssueKey ?? view.parentIssueKey,
                });
              }
            } catch (error) {
              errors.push(`Transition ${created.key}: ${errorMessage(error)}`);
            }
          }
        }

        local.issueKey = created.key;
        if (external) {
          local.ytrackerIssueKey = created.key;
        }
        local.dirty = true;
        markRootDirty(local);
        if (!localByKey.has(created.key)) {
          localByKey.set(created.key, local);
        }
        syncedIssueKeys.add(created.key);

        if (!dryRun) {
          await runLabelReconcile(
            options.client,
            created,
            ctx,
            dryRun,
            counts,
            actions,
          );
        }
        await runAssigneeReconcile(
          options.client,
          local,
          created,
          ctx,
          dryRun,
          counts,
          actions,
          errors,
        );
        runTimeSpentReconcile(local, created, counts, actions);

        writeLedgerFromRemote(workingLedger, key, created, now);

        createdPending.push({
          mappingKey: key,
          issueKey: created.key,
          title: local.title,
          description: descriptionFromLines(local.descriptionLines),
          status,
          parentIssueKey,
          trackerUpdated: created.updated || now(),
        });
        counts.createdRemote += 1;
        actions.push({
          kind: 'create-remote',
          title: local.title,
          issueKey: created.key,
          detail: external
            ? 'created Tracker issue for external title link; wrote [ytracker::] field'
            : 'unlinked checklist item in the note',
        });
      } catch (error) {
        errors.push(`Create remote "${local.title}": ${errorMessage(error)}`);
      }
      continue;
    }

    const issueKey = local.issueKey.toUpperCase();
    if (syncedIssueKeys.has(issueKey)) {
      // Same Tracker key appears on multiple checklist lines (different Jira
      // URLs / descriptions). Syncing each would thrash push/pull forever.
      counts.duplicateSkips += 1;
      actions.push({
        kind: 'duplicate-skip',
        title: local.title,
        issueKey,
        detail:
          'another checklist line already syncs this Tracker key; left this row unchanged',
      });
      continue;
    }
    syncedIssueKeys.add(issueKey);

    const remote = remoteMap.get(issueKey);
    const entry = workingLedger.entries[ledgerEntryKey(key, issueKey)];

    if (!remote) {
      const hydrateDetail = hydrateErrors.get(issueKey);
      if (entry) {
        entry.unresolved = true;
        unresolvedKeys.push(issueKey);
        counts.unresolvedRemovals += 1;
        actions.push({
          kind: 'unresolved-missing-remote',
          title: local.title || entry.title,
          issueKey,
          detail: dryRun
            ? 'still linked in the note, but not present in the board search payload (dry-run skips key hydrate)'
            : `still linked in the note, but missing from board search` +
              (hydrateDetail ? ` (${hydrateDetail})` : ''),
        });
      } else {
        errors.push(
          `Linked issue ${issueKey} is missing in Tracker` +
            (hydrateDetail ? ` (${hydrateDetail})` : ''),
        );
      }
      continue;
    }

    const localSnap = localSnapshot(local, parentIssueKey, entry);
    const remoteSnap = remoteSnapshot(remote);

    // Both sides already agree on syncable fields (title/status/dates/…).
    // Never report a conflict just because the ledger is missing/stale or the
    // local snapshot has empty trackerStatus* before the first ledger write.
    // Tag/assignee updates bump issue.updatedAt without changing contentHash —
    // those must not look like remote edits either.
    if (contentCoreEqual(localSnap, remoteSnap)) {
      writeLedgerFromRemote(workingLedger, key, remote, now);
      if (entry) {
        entry.unresolved = false;
      }
      counts.unchanged += 1;
      actions.push({ kind: 'unchanged', title: local.title, issueKey });
      await runLabelReconcile(
        options.client,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
      );
      await runAssigneeReconcile(
        options.client,
        local,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
        errors,
      );
      runTimeSpentReconcile(local, remote, counts, actions);
      continue;
    }

    if (!entry) {
      // First time we see this link and the sides disagree — adopt via policy.
      if (options.conflictPolicy === 'prefer-obsidian') {
        await pushLocal(
          options,
          ctx,
          local,
          remote,
          parentIssueKey,
          key,
          workingLedger,
          now,
          counts,
          actions,
          errors,
          true,
          dryRun,
        );
      } else {
        pullRemote(
          local,
          remote,
          key,
          workingLedger,
          now,
          counts,
          actions,
          true,
          options.siteBaseUrl,
        );
        await runLabelReconcile(
          options.client,
          remote,
          ctx,
          dryRun,
          counts,
          actions,
        );
        await runAssigneeReconcile(
          options.client,
          local,
          remote,
          ctx,
          dryRun,
          counts,
          actions,
          errors,
        );
        runTimeSpentReconcile(local, remote, counts, actions);
      }
      continue;
    }

    // Core fields vs ledger (day-level dates, trimmed titles). Full contentHash
    // still includes trackerStatus* for ledger storage, but column-id drift
    // alone must not look like an Obsidian edit.
    const entrySnap = snapshotFromLedger(entry);
    const localChanged = !contentCoreEqual(localSnap, entrySnap);
    const remoteChanged = !contentCoreEqual(remoteSnap, entrySnap);

    if (!localChanged && !remoteChanged) {
      entry.unresolved = false;
      // Keep exact Tracker column identity + updatedAt fresh in the ledger.
      writeLedgerFromRemote(workingLedger, key, remote, now);
      counts.unchanged += 1;
      actions.push({ kind: 'unchanged', title: local.title, issueKey });
      await runLabelReconcile(
        options.client,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
      );
      await runAssigneeReconcile(
        options.client,
        local,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
        errors,
      );
      runTimeSpentReconcile(local, remote, counts, actions);
      continue;
    }

    if (localChanged && !remoteChanged) {
      await pushLocal(
        options,
        ctx,
        local,
        remote,
        parentIssueKey,
        key,
        workingLedger,
        now,
        counts,
        actions,
        errors,
        false,
        dryRun,
      );
      continue;
    }

    if (!localChanged && remoteChanged) {
      pullRemote(
        local,
        remote,
        key,
        workingLedger,
        now,
        counts,
        actions,
        false,
        options.siteBaseUrl,
      );
      await runLabelReconcile(
        options.client,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
      );
      await runAssigneeReconcile(
        options.client,
        local,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
        errors,
      );
      runTimeSpentReconcile(local, remote, counts, actions);
      continue;
    }

    // True conflict: both sides disagree with the ledger AND with each other.
    if (options.conflictPolicy === 'prefer-obsidian') {
      await pushLocal(
        options,
        ctx,
        local,
        remote,
        parentIssueKey,
        key,
        workingLedger,
        now,
        counts,
        actions,
        errors,
        true,
        dryRun,
      );
    } else {
      pullRemote(
        local,
        remote,
        key,
        workingLedger,
        now,
        counts,
        actions,
        true,
        options.siteBaseUrl,
      );
      await runLabelReconcile(
        options.client,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
      );
      await runAssigneeReconcile(
        options.client,
        local,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
        errors,
      );
      runTimeSpentReconcile(local, remote, counts, actions);
    }
  }

  const remotes = [...remoteMap.values()].sort((a, b) => {
    if (a.parentIssueKey === null && b.parentIssueKey !== null) {
      return -1;
    }
    if (a.parentIssueKey !== null && b.parentIssueKey === null) {
      return 1;
    }
    return a.key.localeCompare(b.key);
  });

  for (const remote of remotes) {
    if (localByKey.has(remote.key)) {
      continue;
    }
    const entry = workingLedger.entries[ledgerEntryKey(key, remote.key)];
    // Always re-import board issues missing from the note. The old
    // unresolved-missing-local path permanently blocked recovery (common for
    // Blocked/[?] rows that failed to stick in the note on a prior run).
    const restored = Boolean(entry);

    const created = createLocalNode(remote);
    const parentLocal =
      remote.parentIssueKey !== null
        ? localByKey.get(remote.parentIssueKey) ?? null
        : null;
    if (parentLocal) {
      created.indent = `${parentLocal.indent}    `;
      created.parent = parentLocal;
      parentLocal.children.push(created);
      markRootDirty(parentLocal);
    } else {
      created.isNew = true;
      roots.push(created);
    }
    localByKey.set(remote.key, created);
    writeLedgerFromRemote(workingLedger, key, remote, now);
    await runLabelReconcile(
          options.client,
          remote,
          ctx,
          dryRun,
          counts,
          actions,
        );
    await runAssigneeReconcile(
      options.client,
      created,
      remote,
      ctx,
      dryRun,
      counts,
      actions,
      errors,
    );
    runTimeSpentReconcile(created, remote, counts, actions);
    counts.createdLocal += 1;
    const importDetails = restored
      ? ['restored into the note; was linked in the ledger but missing locally']
      : ['exists in Tracker and was never synced to this note'];
    if (remote.dueDateSource === 'end') {
      importDetails.push('due date from Tracker end');
    }
    actions.push({
      kind: 'create-local',
      title: remote.title,
      issueKey: remote.key,
      detail: importDetails.join('; '),
    });
  }

  const nextMarkdown = writeMarkdown(markdown, roots, options.siteBaseUrl);
  const noteChanged = nextMarkdown !== markdown;

  if (noteChanged) {
    if (dryRun) {
      return {
        notePath: mapping.notePath,
        boardId: mapping.boardId,
        labels: filterLabels,
        recency,
        counts,
        actions,
        errors,
        unresolvedIssueKeys: unresolvedKeys,
        pendingLinks: [],
      };
    }

    try {
      await options.writeNote(mapping.notePath, nextMarkdown);
    } catch (error) {
      errors.push(`Write note failed: ${errorMessage(error)}`);
      return {
        notePath: mapping.notePath,
        boardId: mapping.boardId,
        labels: filterLabels,
        recency,
        counts: {
          ...counts,
          createdLocal: 0,
        },
        actions,
        errors,
        unresolvedIssueKeys: unresolvedKeys,
        pendingLinks: createdPending,
      };
    }
  }

  if (!dryRun) {
    commitMappingLedger(ledger, workingLedger, key);
  }

  return {
    notePath: mapping.notePath,
    boardId: mapping.boardId,
    labels: filterLabels,
    recency,
    counts,
    actions,
    errors,
    unresolvedIssueKeys: unresolvedKeys,
    pendingLinks: [],
  };
}

async function pushLocal(
  options: SyncEngineOptions,
  ctx: MappingContext,
  local: MutableTask,
  remote: RemoteIssueView,
  parentIssueKey: string | null,
  key: string,
  ledger: LedgerStore,
  now: () => string,
  counts: MappingSyncCounts,
  actions: SyncActionDetail[],
  errors: string[],
  isConflict: boolean,
  dryRun: boolean,
): Promise<void> {
  try {
    const status = local.status ?? remote.status;
    const dates = buildTrackerDatePayload({
      startDate: local.startDate,
      dueDate: local.dueDate,
    });
    const localDescription = normalizeDescription(
      descriptionFromLines(local.descriptionLines),
    );

    const wantedParent = parentIssueKey?.toUpperCase() ?? null;
    const remoteParent = remote.parentIssueKey?.toUpperCase() ?? null;
    const parentChanged = wantedParent !== remoteParent;
    const summaryChanged = local.title.trim() !== remote.title.trim();
    const descriptionChanged = localDescription !== remote.description;
    const startChanged = syncCalendarDay(local.startDate) !== syncCalendarDay(remote.startDate);
    const dueChanged = syncCalendarDay(local.dueDate) !== syncCalendarDay(remote.dueDate);
    const statusChanged = status !== remote.status;
    // Stale Tracker `end` still wins over deadline on read — clear it when due changes.
    const clearEnd = dueChanged && remote.dueDateSource === 'end';
    const contentChanged =
      summaryChanged ||
      descriptionChanged ||
      startChanged ||
      dueChanged ||
      parentChanged ||
      clearEnd;

    if (!contentChanged && !statusChanged) {
      // Ledger thought Obsidian moved, but Tracker already matches. Repair only.
      writeLedgerFromRemote(ledger, key, remote, now);
      counts.unchanged += 1;
      actions.push({
        kind: 'unchanged',
        title: local.title,
        issueKey: remote.key,
        detail: 'Obsidian and Tracker already match; refreshed ledger',
      });
      await runLabelReconcile(options.client, remote, ctx, dryRun, counts, actions);
      await runAssigneeReconcile(
        options.client,
        local,
        remote,
        ctx,
        dryRun,
        counts,
        actions,
        errors,
      );
      runTimeSpentReconcile(local, remote, counts, actions);
      return;
    }

    if (!dryRun && contentChanged) {
      await options.client.updateIssue(remote.key, {
        summary: local.title,
        description: descriptionFromLines(local.descriptionLines),
        start: dates.start,
        deadline: dates.deadline,
        ...(clearEnd ? { end: null } : {}),
        // Native Tracker parent (not Blocks links); only sent when it changes.
        parentKey: parentChanged ? wantedParent : undefined,
      });
    }

    let columnName = remote.columnName;
    let trackerStatusId = remote.trackerStatusId;
    let trackerStatusName = remote.trackerStatusName;

    if (statusChanged) {
      const targetColumn = pickColumnForCoarseStatus(ctx.columns, status, ctx.statusMeta);
      if (!targetColumn) {
        throw new Error(
          `No board column mapped for status "${status}" on ${remote.key}`,
        );
      }
      const moved = await transitionToColumn(
        options.client,
        remote.key,
        targetColumn,
        status,
        remote.trackerStatusId,
        ctx.doneResolution,
        dryRun,
      );
      if (dryRun) {
        columnName = targetColumn.name;
        const primaryStatusId = targetColumn.statusIds[0];
        if (primaryStatusId) {
          trackerStatusId = primaryStatusId;
        }
        trackerStatusName = targetColumn.name;
      } else if (moved) {
        const refreshed = await options.client.getIssue(remote.key);
        const view = toRemoteIssueView(refreshed, ctx.columns, {
          statusMeta: ctx.statusMeta,
        });
        columnName = view.columnName;
        trackerStatusId = view.trackerStatusId;
        trackerStatusName = view.trackerStatusName;
        if (view.status !== status) {
          throw new Error(
            `Transition ${remote.key} finished in "${view.trackerStatusName}" ` +
              `(${view.status}), expected ${status}`,
          );
        }
      } else {
        // Already in target column — refresh names from the column.
        columnName = targetColumn.name;
        const primaryStatusId = targetColumn.statusIds[0];
        if (primaryStatusId) {
          trackerStatusId = primaryStatusId;
        }
        trackerStatusName = targetColumn.name;
      }
    }

    const labelRemote: RemoteIssueView = {
      ...remote,
      title: local.title,
      description: normalizeDescription(descriptionFromLines(local.descriptionLines)),
      status,
      columnName,
      trackerStatusId,
      trackerStatusName,
      parentIssueKey,
      startDate: local.startDate,
      dueDate: local.dueDate,
      labels: remote.labels,
    };

    await runLabelReconcile(
      options.client,
      labelRemote,
      ctx,
      dryRun,
      counts,
      actions,
    );
    await runAssigneeReconcile(
      options.client,
      local,
      labelRemote,
      ctx,
      dryRun,
      counts,
      actions,
      errors,
    );
    runTimeSpentReconcile(local, labelRemote, counts, actions);

    writeLedgerFromLocal(
      ledger,
      key,
      remote.key,
      local,
      parentIssueKey,
      status,
      // Prefer Tracker's stamp; fall back to now only when the payload had none.
      remote.updated || now(),
      trackerStatusId,
      trackerStatusName,
      now,
    );

    local.dirty = true;
    markRootDirty(local);

    if (isConflict) {
      counts.conflictsResolved += 1;
      actions.push({
        kind: 'conflict-push',
        title: local.title,
        issueKey: remote.key,
        detail: 'both sides changed; Obsidian wins',
      });
    } else {
      counts.pushed += 1;
      actions.push({
        kind: 'push',
        title: local.title,
        issueKey: remote.key,
      });
    }
  } catch (error) {
    errors.push(`Push ${remote.key}: ${errorMessage(error)}`);
  }
}

function pullRemote(
  local: MutableTask,
  remote: RemoteIssueView,
  key: string,
  ledger: LedgerStore,
  now: () => string,
  counts: MappingSyncCounts,
  actions: SyncActionDetail[],
  isConflict: boolean,
  siteBaseUrl: string,
): void {
  local.title = remote.title;
  local.descriptionLines = descriptionToLines(remote.description);
  local.status = remote.status;
  local.checkboxChar = checkboxCharForStatus(remote.status);
  local.startDate = remote.startDate;
  local.dueDate = remote.dueDate;
  local.issueKey = remote.key;
  if (isExternalTitleLink(local, siteBaseUrl)) {
    local.ytrackerIssueKey = remote.key;
    // Keep external titleLinkUrl; only the display text (title) changes above.
  } else {
    local.titleLinkUrl = null;
    local.ytrackerIssueKey = null;
  }
  local.dirty = true;
  markRootDirty(local);
  writeLedgerFromRemote(ledger, key, remote, now);
  const details: string[] = [];
  if (isConflict) {
    details.push('both sides changed; Tracker wins');
  }
  if (remote.dueDateSource === 'end') {
    details.push('due date from Tracker end');
  }
  if (isConflict) {
    counts.conflictsResolved += 1;
    actions.push({
      kind: 'conflict-pull',
      title: remote.title,
      issueKey: remote.key,
      detail: details.join('; ') || undefined,
    });
  } else {
    counts.pulled += 1;
    actions.push({
      kind: 'pull',
      title: remote.title,
      issueKey: remote.key,
      detail: details.length > 0 ? details.join('; ') : undefined,
    });
  }
}

/**
 * Sync Dataview `[assignee:: …]` ↔ Tracker assignee for open tasks.
 * Skipped when both Obsidian and Tracker are done. Unmapped users are ignored.
 */
async function runAssigneeReconcile(
  client: TrackerClient,
  local: MutableTask,
  remote: RemoteIssueView,
  ctx: MappingContext,
  dryRun: boolean,
  counts: MappingSyncCounts,
  actions: SyncActionDetail[],
  errors: string[],
): Promise<void> {
  if (ctx.assigneeMappings.length === 0) {
    return;
  }
  if (local.status === 'done' && remote.status === 'done') {
    return;
  }

  const decision = decideAssigneeReconcile({
    localAssignee: local.assignee,
    remoteAssigneeId: remote.assigneeAccountId,
    mappings: ctx.assigneeMappings,
  });

  if (decision.action === 'none') {
    return;
  }

  try {
    if (decision.action === 'set-local') {
      local.assignee = decision.obsidianValue;
      local.dirty = true;
      markRootDirty(local);
      counts.assigneeReconciliations += 1;
      actions.push({
        kind: 'reconcile-assignee',
        title: local.title,
        issueKey: remote.key,
        detail: decision.detail,
      });
      return;
    }

    if (!dryRun) {
      await client.updateIssue(remote.key, {
        assignee: toTrackerAssigneeValue(decision.mapping),
      });
    }
    remote.assigneeAccountId = decision.mapping.trackerUserId;
    remote.assigneeDisplayName = decision.mapping.trackerDisplayName;
    counts.assigneeReconciliations += 1;
    actions.push({
      kind: 'reconcile-assignee',
      title: local.title,
      issueKey: remote.key,
      detail: decision.detail,
    });
  } catch (error) {
    errors.push(`Assignee ${remote.key}: ${errorMessage(error)}`);
  }
}

/**
 * Pull-only: Dataview `[timespent:: seconds]` ← Tracker `spent` (ms → s) for open tasks.
 * Skipped when both sides are done. Never writes back to Tracker.
 */
function runTimeSpentReconcile(
  local: MutableTask,
  remote: RemoteIssueView,
  counts: MappingSyncCounts,
  actions: SyncActionDetail[],
): void {
  if (local.status === 'done' && remote.status === 'done') {
    return;
  }
  const decision = decideTimeSpentReconcile({
    localSeconds: local.timeSpentSeconds,
    remoteSeconds: remote.timeSpentSeconds,
  });
  if (decision.action === 'none') {
    return;
  }
  local.timeSpentSeconds = decision.seconds;
  local.dirty = true;
  markRootDirty(local);
  counts.timeSpentReconciliations += 1;
  actions.push({
    kind: 'reconcile-timespent',
    title: local.title,
    issueKey: remote.key,
    detail: decision.detail,
  });
}

/** Column-wins status tag reconcile plus mapping filter tags (tags are string[]). */
async function runLabelReconcile(
  client: TrackerClient,
  remote: RemoteIssueView,
  ctx: MappingContext,
  dryRun: boolean,
  counts: MappingSyncCounts,
  actions: SyncActionDetail[],
): Promise<void> {
  const filterLabels = ctx.filterLabels;
  const statusResult = await reconcileStatusLabels(
    client,
    remote.key,
    remote.labels,
    remote.columnName,
    ctx.columns,
    dryRun,
  );
  let labels = statusResult.labels;
  if (statusResult.changed) {
    counts.labelReconciliations += 1;
    actions.push({
      kind: 'reconcile-labels',
      title: remote.title,
      issueKey: remote.key,
      detail: `align tags with column "${remote.columnName}"`,
    });
  }

  const withFilter = mergeMappingLabels(labels, filterLabels);
  const beforeSet = new Set(labels.map((label) => label.toLowerCase()));
  const afterSet = new Set(withFilter.map((label) => label.toLowerCase()));
  const needsFilterWrite =
    afterSet.size !== beforeSet.size || [...afterSet].some((label) => !beforeSet.has(label));

  if (needsFilterWrite) {
    if (!dryRun) {
      await client.updateIssue(remote.key, { tags: withFilter });
    }
    labels = withFilter;
    counts.labelReconciliations += 1;
    actions.push({
      kind: 'reconcile-labels',
      title: remote.title,
      issueKey: remote.key,
      detail: `ensure mapping filter tags (${normalizeMappingLabels(filterLabels).join(', ')})`,
    });
  }

  remote.labels = labels;
}

async function loadStatusMeta(
  client: TrackerClient,
): Promise<Map<string, { name: string; type?: string }>> {
  const meta = new Map<string, { name: string; type?: string }>();
  try {
    const statuses = await client.listStatuses();
    for (const status of statuses) {
      const entry = {
        name: String(status.display ?? status.name ?? status.key ?? ''),
        type: status.type,
      };
      if (status.key) {
        meta.set(String(status.key), entry);
        meta.set(String(status.key).toLowerCase(), entry);
      }
      if (status.id !== undefined && status.id !== null && status.id !== '') {
        meta.set(String(status.id), entry);
      }
    }
  } catch {
    // Status metadata only refines coarse status inference; names still work.
  }
  return meta;
}

async function loadMappingContext(
  client: TrackerClient,
  boardId: number,
  queueKeyOverride: string | undefined,
  filterLabels: readonly string[] = [],
  assigneeMappings: readonly AssigneeMapping[] | undefined = [],
  doneResolution: string | undefined = '',
): Promise<MappingContext> {
  const [board, trackerColumns, statusMeta] = await Promise.all([
    client.getBoard(boardId),
    client.getBoardColumnsWithStatuses(boardId),
    loadStatusMeta(client),
  ]);
  const columns = columnsFromBoardConfig(trackerColumns);
  const queueKey = (
    String(queueKeyOverride ?? '').trim() ||
    String(board.defaultQueue?.key ?? '').trim()
  ).toUpperCase();
  return {
    columns,
    queueKey,
    statusMeta,
    filterLabels: normalizeMappingLabels(filterLabels),
    assigneeMappings: normalizeAssigneeMappings(assigneeMappings),
    doneResolution: String(doneResolution ?? '').trim(),
  };
}

async function createRemoteIssue(
  client: TrackerClient,
  ctx: MappingContext,
  local: MutableTask,
  parentIssueKey: string | null,
  tags: string[],
): Promise<RemoteIssueView> {
  const dates = buildTrackerDatePayload({
    startDate: local.startDate,
    dueDate: local.dueDate,
  });
  const assigneeMapping = findMappingByObsidianValue(ctx.assigneeMappings, local.assignee);

  // Nesting = native Tracker parent.
  const created: TrackerIssue = await client.createIssue({
    queue: ctx.queueKey,
    summary: local.title,
    description: descriptionFromLines(local.descriptionLines),
    parentKey: parentIssueKey ?? undefined,
    tags: tags.length > 0 ? tags : undefined,
    start: dates.start ?? undefined,
    deadline: dates.deadline ?? undefined,
    assignee: assigneeMapping ? toTrackerAssigneeValue(assigneeMapping) : undefined,
  });

  const view = toRemoteIssueView(created, ctx.columns, { statusMeta: ctx.statusMeta });
  return parentIssueKey
    ? { ...view, parentIssueKey: parentIssueKey.toUpperCase() }
    : view;
}

/**
 * Move an issue into a board column via Tracker workflow transitions
 * (multi-hop when Open→Done is not a single edge).
 * Returns true when a transition ran. No-ops when the issue is already in the column.
 */
async function transitionToColumn(
  client: TrackerClient,
  issueKey: string,
  column: BoardColumnView,
  targetStatus: TaskStatus,
  currentStatusId: string,
  doneResolution: string,
  dryRun: boolean,
): Promise<boolean> {
  if (dryRun) {
    return false;
  }
  if (column.statusIds.length === 0) {
    throw new Error(
      `Column "${column.name}" has no status ids for ${issueKey}; cannot transition`,
    );
  }
  const current = currentStatusId.trim().toLowerCase();
  if (current && column.statusIds.some((id) => id.trim().toLowerCase() === current)) {
    return false;
  }
  const resolution = targetStatus === 'done' && doneResolution ? doneResolution : undefined;
  return client.transitionTowardStatuses(issueKey, column.statusIds, { resolution });
}

function takePendingMatch(
  pending: PendingLink[],
  title: string,
  parentIssueKey: string | null,
): PendingLink | null {
  const index = pending.findIndex(
    (item) => item.title === title && item.parentIssueKey === parentIssueKey,
  );
  if (index < 0) {
    return null;
  }
  const [match] = pending.splice(index, 1);
  return match ?? null;
}

function fakeCreatedIssue(
  local: MutableTask,
  queueKey: string,
  status: TaskStatus,
  column: BoardColumnView | null,
  updated: string,
  labels: string[] = [],
): RemoteIssueView {
  fakeIssueCounter += 1;
  const key = `FAKE-${fakeIssueCounter}`;
  const columnName = column?.name ?? 'To Do';
  return {
    key,
    title: local.title,
    description: normalizeDescription(descriptionFromLines(local.descriptionLines)),
    status,
    trackerStatusId: column?.statusIds[0] ?? '',
    trackerStatusName: columnName,
    columnName,
    parentIssueKey: local.parent?.issueKey?.toUpperCase() ?? null,
    labels: [...labels],
    startDate: local.startDate,
    dueDate: local.dueDate,
    startDateSource: local.startDate ? 'start' : null,
    dueDateSource: local.dueDate ? 'deadline' : null,
    trackerStartDate: local.startDate,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    timeSpentSeconds: local.timeSpentSeconds,
    updated,
    projectKey: queueKey,
    isSubtask: local.parent?.issueKey !== null && local.parent?.issueKey !== undefined,
  };
}

function writeLedgerFromRemote(
  ledger: LedgerStore,
  key: string,
  remote: RemoteIssueView,
  now: () => string,
): void {
  ledger.entries[ledgerEntryKey(key, remote.key)] = makeLedgerEntry({
    issueKey: remote.key,
    mappingKey: key,
    title: remote.title,
    description: remote.description,
    status: remote.status,
    trackerStatusId: remote.trackerStatusId,
    trackerStatusName: remote.trackerStatusName,
    parentIssueKey: remote.parentIssueKey,
    startDate: remote.startDate,
    dueDate: remote.dueDate,
    trackerUpdated: remote.updated || now(),
    lastSyncedAt: now(),
    unresolved: false,
  });
}

function writeLedgerFromLocal(
  ledger: LedgerStore,
  key: string,
  issueKey: string,
  local: MutableTask,
  parentIssueKey: string | null,
  status: TaskStatus,
  trackerUpdated: string,
  trackerStatusId: string,
  trackerStatusName: string,
  now: () => string,
): void {
  ledger.entries[ledgerEntryKey(key, issueKey)] = makeLedgerEntry({
    issueKey,
    mappingKey: key,
    title: local.title,
    description: normalizeDescription(descriptionFromLines(local.descriptionLines)),
    status,
    trackerStatusId,
    trackerStatusName,
    parentIssueKey,
    startDate: local.startDate,
    dueDate: local.dueDate,
    trackerUpdated,
    lastSyncedAt: now(),
    unresolved: false,
  });
}

function localSnapshot(
  local: MutableTask,
  parentIssueKey: string | null,
  entry: LedgerEntry | undefined,
): ContentSnapshot {
  const status = local.status ?? entry?.status ?? 'todo';
  let trackerStatusId = '';
  let trackerStatusName = '';
  if (entry) {
    if (status === entry.status) {
      trackerStatusId = entry.trackerStatusId;
      trackerStatusName = entry.trackerStatusName;
    } else {
      trackerStatusId = `local:${status}`;
      trackerStatusName = `local:${status}`;
    }
  }
  return contentSnapshot({
    title: local.title,
    // Match remote/ledger hashing (normalizeDescription) so whitespace/HTML
    // round-trips do not look like perpetual local edits.
    description: normalizeDescription(descriptionFromLines(local.descriptionLines)),
    status,
    trackerStatusId,
    trackerStatusName,
    parentIssueKey,
    startDate: local.startDate,
    dueDate: local.dueDate,
  });
}

function remoteSnapshot(remote: RemoteIssueView): ContentSnapshot {
  return contentSnapshot({
    title: remote.title,
    description: remote.description,
    status: remote.status,
    trackerStatusId: remote.trackerStatusId,
    trackerStatusName: remote.trackerStatusName,
    parentIssueKey: remote.parentIssueKey,
    startDate: remote.startDate,
    dueDate: remote.dueDate,
  });
}

function fromParsed(node: ParsedTaskNode, parent: MutableTask | null): MutableTask {
  const mutable: MutableTask = {
    lineIndex: node.lineIndex,
    endLineIndex: node.endLineIndex,
    indent: node.indent,
    listMarker: node.listMarker,
    checkboxChar: node.checkboxChar,
    status: node.status,
    title: node.title,
    descriptionLines: [...node.descriptionLines],
    issueKey: node.issueKey ? node.issueKey.toUpperCase() : null,
    titleLinkUrl: node.titleLinkUrl,
    ytrackerIssueKey: node.ytrackerIssueKey
      ? node.ytrackerIssueKey.toUpperCase()
      : null,
    unknownInlineFields: [...node.unknownInlineFields],
    startDate: node.startDate,
    dueDate: node.dueDate,
    assignee: node.assignee,
    timeSpentSeconds: node.timeSpentSeconds,
    children: [],
    parent,
    isNew: false,
    dirty: false,
  };
  mutable.children = node.children.map((child) => fromParsed(child, mutable));
  return mutable;
}

function createLocalNode(remote: RemoteIssueView): MutableTask {
  return {
    lineIndex: null,
    endLineIndex: null,
    indent: '',
    listMarker: '-',
    checkboxChar: checkboxCharForStatus(remote.status),
    status: remote.status,
    title: remote.title,
    descriptionLines: descriptionToLines(remote.description),
    issueKey: remote.key,
    titleLinkUrl: null,
    ytrackerIssueKey: null,
    unknownInlineFields: [],
    startDate: remote.startDate,
    dueDate: remote.dueDate,
    assignee: null,
    timeSpentSeconds: null,
    children: [],
    parent: null,
    isNew: true,
    dirty: true,
  };
}

/** True when the title is a markdown link that does not point at this Tracker site. */
function isExternalTitleLink(task: MutableTask, siteBaseUrl: string): boolean {
  const url = task.titleLinkUrl?.trim() ?? '';
  if (!url) {
    return false;
  }
  return extractIssueKeyFromUrl(url, siteBaseUrl) === null;
}

function walkMutable(roots: MutableTask[], visit: (task: MutableTask) => void): void {
  const walk = (task: MutableTask): void => {
    visit(task);
    for (const child of task.children) {
      walk(child);
    }
  };
  for (const root of roots) {
    walk(root);
  }
}

function markRootDirty(task: MutableTask): void {
  let cursor: MutableTask | null = task;
  while (cursor.parent) {
    cursor = cursor.parent;
  }
  cursor.dirty = true;
}

function toRenderable(task: MutableTask): RenderableTask {
  return {
    indent: task.indent,
    listMarker: task.listMarker,
    checkboxChar: task.checkboxChar,
    title: task.title,
    issueKey: task.issueKey,
    titleLinkUrl: task.titleLinkUrl,
    ytrackerIssueKey: task.ytrackerIssueKey,
    unknownInlineFields: task.unknownInlineFields,
    startDate: task.startDate,
    dueDate: task.dueDate,
    assignee: task.assignee,
    timeSpentSeconds: task.timeSpentSeconds,
    descriptionLines: task.descriptionLines,
    children: task.children.map(toRenderable),
  };
}

function writeMarkdown(markdown: string, roots: MutableTask[], baseUrl: string): string {
  const replacements: Array<{
    lineIndex: number | null;
    endLineIndex: number | null;
    rendered: string;
  }> = [];

  for (const root of roots) {
    if (root.isNew) {
      replacements.push({
        lineIndex: null,
        endLineIndex: null,
        rendered: renderTask(toRenderable(root), baseUrl),
      });
      continue;
    }
    if (root.dirty || root.children.some(isDirtyTree)) {
      replacements.push({
        lineIndex: root.lineIndex,
        endLineIndex: root.endLineIndex,
        rendered: renderTask(toRenderable(root), baseUrl),
      });
    }
  }

  if (replacements.length === 0) {
    return markdown;
  }
  return applyRootReplacements(markdown, replacements);
}

function isDirtyTree(task: MutableTask): boolean {
  if (task.dirty || task.isNew) {
    return true;
  }
  return task.children.some(isDirtyTree);
}

export function normalizeNotePath(path: string): string {
  return path.trim().replace(/^\/+/, '');
}

function emptyCounts(): MappingSyncCounts {
  return {
    createdRemote: 0,
    createdLocal: 0,
    pushed: 0,
    pulled: 0,
    conflictsResolved: 0,
    unchanged: 0,
    unresolvedRemovals: 0,
    recoveredPendingLinks: 0,
    duplicateSkips: 0,
    labelReconciliations: 0,
    assigneeReconciliations: 0,
    timeSpentReconciliations: 0,
  };
}

function addCounts(a: MappingSyncCounts, b: MappingSyncCounts): MappingSyncCounts {
  return {
    createdRemote: a.createdRemote + b.createdRemote,
    createdLocal: a.createdLocal + b.createdLocal,
    pushed: a.pushed + b.pushed,
    pulled: a.pulled + b.pulled,
    conflictsResolved: a.conflictsResolved + b.conflictsResolved,
    unchanged: a.unchanged + b.unchanged,
    unresolvedRemovals: a.unresolvedRemovals + b.unresolvedRemovals,
    recoveredPendingLinks: a.recoveredPendingLinks + b.recoveredPendingLinks,
    duplicateSkips: a.duplicateSkips + b.duplicateSkips,
    labelReconciliations: a.labelReconciliations + b.labelReconciliations,
    assigneeReconciliations: a.assigneeReconciliations + b.assigneeReconciliations,
    timeSpentReconciliations: a.timeSpentReconciliations + b.timeSpentReconciliations,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeRun(
  totals: MappingSyncCounts,
  errorCount: number,
  mappingCount: number,
  dryRun: boolean,
  actions: SyncActionDetail[],
): string {
  const prefix = dryRun ? 'Tracker Sync dry-run' : 'Tracker Sync';
  const parts = [`${mappingCount} mapping${mappingCount === 1 ? '' : 's'}`];

  const createRemote = countKind(actions, 'create-remote');
  const createLocal = countKind(actions, 'create-local');
  const push = countKind(actions, 'push');
  const pull = countKind(actions, 'pull');
  const conflicts =
    countKind(actions, 'conflict-push') + countKind(actions, 'conflict-pull');
  const unresolved =
    countKind(actions, 'unresolved-missing-remote') +
    countKind(actions, 'unresolved-missing-local');
  const recovered = countKind(actions, 'recovered-pending');
  const duplicates = countKind(actions, 'duplicate-skip');
  const labelFixes = countKind(actions, 'reconcile-labels');
  const assigneeFixes = countKind(actions, 'reconcile-assignee');
  const timeSpentFixes = countKind(actions, 'reconcile-timespent');

  if (createRemote > 0) {
    parts.push(
      dryRun
        ? `${createRemote} would create in Tracker`
        : `${createRemote} created in Tracker`,
    );
  }
  if (createLocal > 0) {
    parts.push(
      dryRun
        ? `${createLocal} would import into Obsidian`
        : `${createLocal} imported into Obsidian`,
    );
  }
  if (push > 0) {
    parts.push(dryRun ? `${push} would push` : `${push} pushed`);
  }
  if (pull > 0) {
    parts.push(dryRun ? `${pull} would pull` : `${pull} pulled`);
  }
  if (conflicts > 0) {
    parts.push(
      dryRun
        ? `${conflicts} would resolve conflict${conflicts === 1 ? '' : 's'}`
        : `${conflicts} conflict${conflicts === 1 ? '' : 's'} resolved`,
    );
  }
  if (recovered > 0) {
    parts.push(dryRun ? `${recovered} would relink` : `${recovered} relinked`);
  }
  if (duplicates > 0) {
    parts.push(
      `${duplicates} duplicate link${duplicates === 1 ? '' : 's'} skipped`,
    );
  }
  if (labelFixes > 0) {
    parts.push(
      dryRun
        ? `${labelFixes} would reconcile tags`
        : `${labelFixes} tag reconciliation${labelFixes === 1 ? '' : 's'}`,
    );
  }
  if (assigneeFixes > 0) {
    parts.push(
      dryRun
        ? `${assigneeFixes} would sync assignee`
        : `${assigneeFixes} assignee sync${assigneeFixes === 1 ? '' : 's'}`,
    );
  }
  if (timeSpentFixes > 0) {
    parts.push(
      dryRun
        ? `${timeSpentFixes} would sync time spent from Tracker`
        : `${timeSpentFixes} time spent sync${timeSpentFixes === 1 ? '' : 's'} from Tracker`,
    );
  }
  if (unresolved > 0) {
    parts.push(`${unresolved} unresolved`);
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  }

  const hadMutations =
    createRemote > 0 ||
    createLocal > 0 ||
    push > 0 ||
    pull > 0 ||
    conflicts > 0 ||
    recovered > 0;
  // Duplicates are informational; still show unchanged when that was the real work.
  if (totals.unchanged > 0 && !hadMutations) {
    // Idle / tag-only runs: surface that content was already in sync.
    parts.push(`${totals.unchanged} unchanged`);
  } else if (parts.length === 1) {
    parts.push('nothing to do');
  }

  return `${prefix}: ${parts.join(', ')}`;
}

function countKind(actions: SyncActionDetail[], kind: SyncActionDetail['kind']): number {
  return actions.reduce((sum, action) => sum + (action.kind === kind ? 1 : 0), 0);
}
