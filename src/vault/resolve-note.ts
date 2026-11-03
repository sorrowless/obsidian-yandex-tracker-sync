import { normalizePath, TFile, type App } from 'obsidian';
import { normalizeMappingPath } from '../settings';
import { basenameKey, pathMatchKey } from './path-match';

export { pathsReferToSameNote } from './path-match';

/**
 * Resolve a settings note path to a vault TFile.
 * Handles Obsidian normalizePath, Unicode NFC/NFD (common on macOS with Cyrillic),
 * and a final scan of markdown files when exact lookup fails.
 */
export function resolveMarkdownFile(app: App, rawPath: string): TFile {
  const trimmed = normalizeMappingPath(rawPath);
  if (!trimmed) {
    throw new Error('Note path is empty');
  }

  const candidates = uniquePaths([
    trimmed,
    normalizePath(trimmed),
    normalizePath(trimmed.normalize('NFC')),
    normalizePath(trimmed.normalize('NFD')),
    trimmed.normalize('NFC'),
    trimmed.normalize('NFD'),
  ]);

  for (const candidate of candidates) {
    const exact = app.vault.getAbstractFileByPath(candidate);
    if (exact instanceof TFile) {
      return exact;
    }
    const byFile = app.vault.getFileByPath?.(candidate);
    if (byFile instanceof TFile) {
      return byFile;
    }
  }

  const matched = findMarkdownByNormalizedPath(app, trimmed);
  if (matched) {
    return matched;
  }

  throw new Error(
    `Note not found: ${trimmed}. Use “Browse…” in settings to pick the file from the vault (paths with Cyrillic/spaces must match Obsidian’s exact path).`,
  );
}

function findMarkdownByNormalizedPath(app: App, wanted: string): TFile | null {
  const wantedKey = pathMatchKey(wanted);
  const wantedBase = basenameKey(wanted);

  const markdownFiles = app.vault.getMarkdownFiles();
  const exact = markdownFiles.find((file) => pathMatchKey(file.path) === wantedKey);
  if (exact) {
    return exact;
  }

  const byBase = markdownFiles.filter((file) => basenameKey(file.path) === wantedBase);
  if (byBase.length === 1) {
    return byBase[0] ?? null;
  }

  return null;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  return result;
}
