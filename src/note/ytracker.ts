import {
  extractIssueKeyFromUrl,
  isIssueKey,
  issueBrowseUrl,
  parseMarkdownLinkAtStart,
} from '../tracker/urls';

/** Dataview inline field key for the Tracker issue identity (dual-link mode). */
export const YTRACKER_FIELD_KEY = 'ytracker';

/**
 * Match `[ytracker:: …]` including nested `[KEY](url)` values.
 * Non-greedy up to the balancing `]` that closes the field is handled by
 * scanning rather than a single regex when the value contains brackets.
 */
const YTRACKER_FIELD_PREFIX_RE = /\[ytracker::\s*/giu;

/**
 * Extract `[ytracker:: value]` from task-line text.
 * Value may be a markdown link `[CL-1](url)` or a bare issue key.
 */
export function parseYtrackerField(
  text: string,
  trackerSiteBaseUrl: string,
): {
  ytrackerIssueKey: string | null;
  remainder: string;
} {
  const re = new RegExp(YTRACKER_FIELD_PREFIX_RE.source, 'giu');
  const match = re.exec(text);
  if (!match) {
    return { ytrackerIssueKey: null, remainder: text };
  }
  const start = match.index;
  const valueStart = start + match[0].length;
  const valueEnd = findClosingBracket(text, valueStart);
  if (valueEnd < 0) {
    return { ytrackerIssueKey: null, remainder: text };
  }
  const rawValue = text.slice(valueStart, valueEnd).trim();
  const ytrackerIssueKey = resolveYtrackerValue(rawValue, trackerSiteBaseUrl);
  const remainder = `${text.slice(0, start)} ${text.slice(valueEnd + 1)}`
    .replace(/\s+/g, ' ')
    .trim();
  return { ytrackerIssueKey, remainder };
}

function findClosingBracket(text: string, from: number): number {
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

function resolveYtrackerValue(raw: string, trackerSiteBaseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const link = parseMarkdownLinkAtStart(trimmed);
  if (link && link.rest.trim() === '') {
    return (
      extractIssueKeyFromUrl(link.url, trackerSiteBaseUrl) ??
      (isIssueKey(link.title) ? link.title.trim().toUpperCase() : null)
    );
  }
  if (isIssueKey(trimmed)) {
    return trimmed.trim().toUpperCase();
  }
  return null;
}

/** Trailing Dataview field for dual-link Tracker identity. */
export function formatYtrackerSuffix(
  issueKey: string | null | undefined,
  siteBaseUrl: string,
): string {
  const key = typeof issueKey === 'string' ? issueKey.trim().toUpperCase() : '';
  if (!key || !isIssueKey(key)) {
    return '';
  }
  const url = issueBrowseUrl(siteBaseUrl, key);
  return ` [${YTRACKER_FIELD_KEY}:: [${key}](${url})]`;
}
