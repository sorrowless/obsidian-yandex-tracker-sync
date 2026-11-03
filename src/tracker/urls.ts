/** Normalized API or site root without trailing slash. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** Tracker REST API v3 root. */
export function apiV3Root(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v3`;
}

/** Frontend issue URL written into Obsidian notes: `{site}/QUEUE-123`. */
export function issueBrowseUrl(siteBaseUrl: string, issueKey: string): string {
  return `${normalizeBaseUrl(siteBaseUrl)}/${issueKey.toUpperCase()}`;
}

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;

export function isIssueKey(value: string): boolean {
  return ISSUE_KEY_RE.test(value.trim());
}

/**
 * Extract a Tracker issue key from a URL if it belongs to this site.
 * Accepts `{site}/QUEUE-123` with optional trailing slash / query / hash.
 */
export function extractIssueKeyFromUrl(url: string, siteBaseUrl: string): string | null {
  const normalizedBase = normalizeBaseUrl(siteBaseUrl);
  if (!normalizedBase || !url.trim()) {
    return null;
  }

  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(url.trim());
    expected = new URL(normalizedBase);
  } catch {
    return null;
  }

  if (parsed.origin !== expected.origin) {
    return null;
  }

  const basePath = expected.pathname.replace(/\/+$/, '');
  const path = parsed.pathname.replace(/\/+$/, '');

  let keyPart: string | null = null;
  if (basePath && path.startsWith(`${basePath}/`)) {
    keyPart = path.slice(basePath.length + 1);
  } else if (!basePath || basePath === '/') {
    const match = path.match(/^\/([^/]+)$/);
    keyPart = match?.[1] ?? null;
  }

  if (!keyPart || keyPart.includes('/')) {
    return null;
  }
  if (!isIssueKey(keyPart)) {
    return null;
  }
  return keyPart.toUpperCase();
}

/**
 * Parse a Markdown link at the start of `body`: `[title](url)` with optional rest.
 * Title may contain nested brackets (e.g. Obsidian `[[wikilink]]` as link text).
 */
export function parseMarkdownLinkAtStart(
  body: string,
): { title: string; url: string; rest: string } | null {
  const input = body;
  if (!input.startsWith('[')) {
    return null;
  }
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '[') {
      depth += 1;
      continue;
    }
    if (ch !== ']') {
      continue;
    }
    depth -= 1;
    if (depth !== 0) {
      continue;
    }
    if (input[i + 1] !== '(') {
      return null;
    }
    const urlStart = i + 2;
    let urlEnd = -1;
    for (let j = urlStart; j < input.length; j += 1) {
      if (input[j] === ')') {
        urlEnd = j;
        break;
      }
      if (/\s/u.test(input[j] ?? '')) {
        return null;
      }
    }
    if (urlEnd < 0) {
      return null;
    }
    const title = input.slice(1, i);
    const url = input.slice(urlStart, urlEnd);
    if (!url) {
      return null;
    }
    const after = input.slice(urlEnd + 1);
    const rest = after.replace(/^\s+/u, '');
    return { title, url, rest };
  }
  return null;
}

/** Parse a line body that is exactly `[title](url)`. */
export function parseMarkdownLink(body: string): { title: string; url: string } | null {
  const parsed = parseMarkdownLinkAtStart(body.trim());
  if (!parsed || parsed.rest !== '') {
    return null;
  }
  return { title: parsed.title, url: parsed.url };
}
