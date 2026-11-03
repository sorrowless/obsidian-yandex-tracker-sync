/**
 * Mapping label filters: empty filter means “all issues on the board”.
 * Non-empty filter matches when the issue has **any** of the listed labels (OR).
 * Comparison is case-insensitive.
 */

/** Normalize mapping filter labels: trim, drop empties, de-dupe case-insensitively, stable order. */
export function normalizeMappingLabels(labels: readonly string[] | null | undefined): string[] {
  if (!labels || labels.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  result.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return result;
}

/** Parse a comma/semicolon-separated label string from settings UI. */
export function parseLabelListInput(value: string): string[] {
  return normalizeMappingLabels(
    value
      .split(/[,;\n]/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

export function formatLabelList(labels: readonly string[]): string {
  return normalizeMappingLabels(labels).join(', ');
}

export function issueMatchesLabelFilter(
  issueLabels: readonly string[] | null | undefined,
  filterLabels: readonly string[] | null | undefined,
): boolean {
  const filter = normalizeMappingLabels(filterLabels);
  if (filter.length === 0) {
    return true;
  }
  const present = new Set(
    (issueLabels ?? []).map((label) => String(label).trim().toLowerCase()).filter(Boolean),
  );
  return filter.some((label) => present.has(label.toLowerCase()));
}

/**
 * Merge mapping filter labels into an issue label list without duplicating
 * (case-insensitive). Preserves existing label casing when already present.
 */
export function mergeMappingLabels(
  existing: readonly string[] | null | undefined,
  filterLabels: readonly string[] | null | undefined,
): string[] {
  const result = [...(existing ?? [])].map((label) => String(label));
  const present = new Set(result.map((label) => label.trim().toLowerCase()));
  for (const label of normalizeMappingLabels(filterLabels)) {
    const key = label.toLowerCase();
    if (present.has(key)) {
      continue;
    }
    present.add(key);
    result.push(label);
  }
  return result;
}
