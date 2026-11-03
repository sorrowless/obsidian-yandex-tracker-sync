/**
 * Minimal HTTP abstraction so the Tracker client can use Obsidian's
 * `requestUrl` (no CORS) in the plugin and a fetch mock in unit tests.
 */

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** Header names are lower-cased. */
  headers: Record<string, string>;
  text: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export function createFetchTransport(fetchImpl: typeof fetch = fetch.bind(globalThis)): HttpTransport {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const text = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      text,
    };
  };
}

/**
 * Obsidian `requestUrl` wrapper — bypasses browser CORS.
 *
 * Important details vs bare `requestUrl`:
 * - Do not pass `body: undefined` (some Electron builds keep the connection open).
 * - Bound every call with a timeout — Obsidian's requestUrl has none and can hang forever.
 */
export function createObsidianRequestTransport(
  requestUrlFn: (options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    throw?: boolean;
  }) => Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
    json?: unknown;
  }>,
  options?: { timeoutMs?: number },
): HttpTransport {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return async (request) => {
    const params: {
      url: string;
      method: string;
      headers: Record<string, string>;
      throw: boolean;
      body?: string;
    } = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      throw: false,
    };
    if (request.body !== undefined) {
      params.body = request.body;
    }

    const response = await withTimeout(
      requestUrlFn(params),
      timeoutMs,
      `${request.method} ${request.url}`,
    );

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }

    let text = '';
    try {
      text = typeof response.text === 'string' ? response.text : '';
    } catch {
      text = '';
    }
    if (!text && response.json !== undefined) {
      try {
        text = typeof response.json === 'string' ? response.json : JSON.stringify(response.json);
      } catch {
        text = '';
      }
    }

    return {
      status: response.status,
      headers,
      text,
    };
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!(timeoutMs > 0)) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Request timed out after ${timeoutMs}ms (${label}). Check API URL, org header, and network; curl may still work if Obsidian's request path is blocked.`,
        ),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
