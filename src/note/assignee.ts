/** Dataview inline field key for the Obsidian-side assignee value. */
export const ASSIGNEE_FIELD_KEY = 'assignee';

const ASSIGNEE_FIELD_RE = /\[assignee::\s*([^\]]+?)\]/giu;

/**
 * Extract `[assignee:: value]` from task-line text.
 * Returns the trimmed value (or null) and the text with the field removed.
 */
export function parseAssigneeField(text: string): {
  assignee: string | null;
  remainder: string;
} {
  let assignee: string | null = null;
  const remainder = text
    .replace(ASSIGNEE_FIELD_RE, (_match, raw: string) => {
      const value = String(raw ?? '').trim();
      if (value && assignee === null) {
        assignee = value;
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { assignee, remainder };
}

/** Trailing Dataview field for the note line (leading space when set). */
export function formatAssigneeSuffix(assignee: string | null | undefined): string {
  const value = typeof assignee === 'string' ? assignee.trim() : '';
  if (!value) {
    return '';
  }
  return ` [${ASSIGNEE_FIELD_KEY}:: ${value}]`;
}

export function normalizeAssigneeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
