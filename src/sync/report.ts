import {
  ACTION_REPORT_ORDER,
  formatActionLabel,
  type SyncActionDetail,
  type SyncActionKind,
} from './actions';
import type { MappingSyncResult, SyncRunResult } from './engine';

/** Max task titles shown per action kind in the short Notice. */
const NOTICE_TITLES_PER_KIND = 5;
/** Max action kinds expanded in the short Notice. */
const NOTICE_KIND_SECTIONS = 4;

/** Flatten mapping errors into user-facing lines. */
export function collectSyncErrors(result: SyncRunResult): string[] {
  const lines: string[] = [];
  for (const mapping of result.mappings) {
    const label = mapping.notePath || `board ${mapping.boardId || '?'}`;
    for (const error of mapping.errors) {
      lines.push(`${label}: ${error}`);
    }
  }
  return lines;
}

/**
 * Short notice text: summary, a few concrete planned actions, and up to a few
 * error details so the user is not left with only opaque counts.
 */
export function formatSyncNotice(result: SyncRunResult, maxErrors = 3): string {
  const parts = [result.message];

  const actionLines = formatActionPreview(result, NOTICE_KIND_SECTIONS, NOTICE_TITLES_PER_KIND);
  if (actionLines.length > 0) {
    parts.push('', ...actionLines);
  }

  const errors = collectSyncErrors(result);
  if (errors.length > 0) {
    const shown = errors.slice(0, maxErrors);
    parts.push('', 'Errors:', ...shown.map((line) => `• ${line}`));
    if (errors.length > maxErrors) {
      parts.push(`• …and ${errors.length - maxErrors} more (see sync report)`);
    }
  }

  return parts.join('\n');
}

/** Full multi-line report for the modal / console. */
export function formatSyncReport(result: SyncRunResult): string {
  const lines: string[] = [result.message, ''];

  for (const mapping of result.mappings) {
    lines.push(formatMappingSection(mapping, result.dryRun));
    lines.push('');
  }

  const errors = collectSyncErrors(result);
  if (errors.length > 0) {
    lines.push('Errors');
    lines.push('------');
    for (const error of errors) {
      lines.push(`• ${error}`);
    }
  }

  return lines.join('\n').trimEnd();
}

function formatMappingSection(mapping: MappingSyncResult, dryRun: boolean): string {
  const bits: string[] = [];
  if (mapping.labels && mapping.labels.length > 0) {
    bits.push(`labels: ${mapping.labels.join(', ')}`);
  }
  if (mapping.recency && mapping.recency.value > 0) {
    const unit = mapping.recency.unit === 'months' ? 'M' : 'd';
    bits.push(`${mapping.recency.field} >= -${mapping.recency.value}${unit}`);
  }
  const filter = bits.length > 0 ? ` [${bits.join('; ')}]` : '';
  const header = mapping.notePath
    ? `${mapping.notePath} → board ${mapping.boardId}${filter}`
    : `board ${mapping.boardId}${filter}`;

  const lines = [header];
  const grouped = groupActions(mapping.actions);

  for (const kind of ACTION_REPORT_ORDER) {
    const items = grouped.get(kind);
    if (!items || items.length === 0) {
      continue;
    }
    lines.push(`  ${formatActionLabel(kind, dryRun)} (${items.length}):`);
    for (const item of items) {
      lines.push(`    • ${formatActionItem(item)}`);
    }
  }

  const unchanged = grouped.get('unchanged')?.length ?? 0;
  if (unchanged > 0) {
    lines.push(`  Unchanged: ${unchanged}`);
  }

  if (mapping.errors.length > 0) {
    lines.push(
      `  ${mapping.errors.length} error${mapping.errors.length === 1 ? '' : 's'} (see below)`,
    );
  }

  if (lines.length === 1) {
    lines.push('  (nothing to do)');
  }

  return lines.join('\n');
}

/** Compact preview used in the Obsidian Notice. */
function formatActionPreview(
  result: SyncRunResult,
  maxKinds: number,
  maxTitlesPerKind: number,
): string[] {
  const all = result.mappings.flatMap((m) => m.actions);
  const grouped = groupActions(all);
  const lines: string[] = [];
  let kindsShown = 0;
  let kindsSkipped = 0;

  for (const kind of ACTION_REPORT_ORDER) {
    const items = grouped.get(kind);
    if (!items || items.length === 0) {
      continue;
    }
    if (kindsShown >= maxKinds) {
      kindsSkipped += 1;
      continue;
    }

    lines.push(`${formatActionLabel(kind, result.dryRun)}:`);
    const shown = items.slice(0, maxTitlesPerKind);
    for (const item of shown) {
      lines.push(`  • ${formatActionItem(item)}`);
    }
    if (items.length > maxTitlesPerKind) {
      lines.push(`  • …and ${items.length - maxTitlesPerKind} more`);
    }
    kindsShown += 1;
  }

  if (kindsSkipped > 0) {
    lines.push('…and more (open Sync report for full list)');
  }

  return lines;
}

function groupActions(actions: SyncActionDetail[]): Map<SyncActionKind, SyncActionDetail[]> {
  const map = new Map<SyncActionKind, SyncActionDetail[]>();
  for (const action of actions) {
    const list = map.get(action.kind);
    if (list) {
      list.push(action);
    } else {
      map.set(action.kind, [action]);
    }
  }
  return map;
}

function formatActionItem(action: SyncActionDetail): string {
  const keyPart =
    action.issueKey != null && action.issueKey.length > 0 ? ` [${action.issueKey}]` : '';
  const detailPart = action.detail ? ` — ${action.detail}` : '';
  return `${action.title || '(untitled)'}${keyPart}${detailPart}`;
}
