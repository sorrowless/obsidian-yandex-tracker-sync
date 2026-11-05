/**
 * Capture unknown Dataview inline fields `[key:: value]` so rewrites can
 * preserve them. Known keys (ytracker, assignee, timespent) are excluded —
 * those are parsed by dedicated helpers before this runs.
 */

const KNOWN_FIELD_KEYS = new Set(['ytracker', 'assignee', 'timespent']);

/**
 * Extract unknown `[key:: value]` segments (value may contain nested `[…]`).
 * Returns raw field strings including brackets, and the remainder text.
 */
export function parseUnknownInlineFields(text: string): {
  unknownInlineFields: string[];
  remainder: string;
} {
  const unknownInlineFields: string[] = [];
  let remainder = text;
  let cursor = 0;
  const out: string[] = [];

  while (cursor < remainder.length) {
    const open = remainder.indexOf('[', cursor);
    if (open < 0) {
      out.push(remainder.slice(cursor));
      break;
    }
    out.push(remainder.slice(cursor, open));
    const afterOpen = open + 1;
    const sep = remainder.indexOf('::', afterOpen);
    if (sep < 0) {
      out.push(remainder.slice(open));
      break;
    }
    const key = remainder.slice(afterOpen, sep).trim().toLowerCase();
    // Ensure this looks like `[key::` with no `]` in the key.
    if (!key || key.includes('[') || key.includes(']')) {
      out.push(remainder.slice(open, open + 1));
      cursor = open + 1;
      continue;
    }
    const valueStart = sep + 2;
    const close = findBalancedClose(remainder, valueStart);
    if (close < 0) {
      out.push(remainder.slice(open));
      break;
    }
    const rawField = remainder.slice(open, close + 1);
    if (KNOWN_FIELD_KEYS.has(key)) {
      // Known fields should already have been stripped; drop leftovers.
      out.push(' ');
    } else {
      unknownInlineFields.push(rawField);
      out.push(' ');
    }
    cursor = close + 1;
  }

  remainder = out.join('').replace(/\s+/g, ' ').trim();
  return { unknownInlineFields, remainder };
}

function findBalancedClose(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Re-emit preserved unknown fields (each already includes brackets). */
export function formatUnknownInlineFieldsSuffix(fields: readonly string[]): string {
  if (!fields.length) {
    return '';
  }
  return ` ${fields.map((field) => field.trim()).filter(Boolean).join(' ')}`;
}
