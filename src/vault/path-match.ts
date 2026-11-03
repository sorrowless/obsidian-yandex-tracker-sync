import { normalizeMappingPath } from '../settings';

/** Comparable key for vault-relative note paths (Unicode NFC, case-insensitive). */
export function pathMatchKey(path: string): string {
  return normalizeSlashes(normalizeMappingPath(path)).normalize('NFC').toLowerCase();
}

export function basenameKey(path: string): string {
  const normalized = normalizeSlashes(normalizeMappingPath(path)).normalize('NFC');
  const parts = normalized.split('/');
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

export function pathsReferToSameNote(left: string, right: string): boolean {
  return pathMatchKey(left) === pathMatchKey(right);
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}
