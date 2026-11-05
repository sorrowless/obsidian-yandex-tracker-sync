import { describe, expect, it } from 'vitest';
import { TrackerClient } from './client';
import type { HttpTransport } from './http';
import { TrackerApiError } from './types';

function mockTransport(
  handler: (request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => { status: number; text: string; headers?: Record<string, string> },
): HttpTransport {
  return async (request) => {
    const result = handler(request);
    return {
      status: result.status,
      text: result.text,
      headers: result.headers ?? { 'content-type': 'application/json' },
    };
  };
}

describe('TrackerClient', () => {
  it('sends OAuth and org headers', async () => {
    const captured: { headers?: Record<string, string> } = {};
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        captured.headers = request.headers;
        return {
          status: 200,
          text: JSON.stringify({ id: 'u1', display: 'Ada', login: 'ada' }),
        };
      }),
    });

    await client.getMyself();
    expect(captured.headers?.Authorization).toBe('OAuth tok');
    expect(captured.headers?.['X-Org-ID']).toBe('org-1');
  });

  it('uses X-Cloud-Org-ID when configured', async () => {
    const captured: { headers?: Record<string, string> } = {};
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'cloud-9',
      orgIdHeader: 'X-Cloud-Org-ID',
      transport: mockTransport((request) => {
        captured.headers = request.headers;
        return { status: 200, text: JSON.stringify({ id: 'u1', display: 'Ada' }) };
      }),
    });
    await client.getMyself();
    expect(captured.headers?.['X-Cloud-Org-ID']).toBe('cloud-9');
  });

  it('lists boards with pagination and respects X-Total-Pages', async () => {
    let pages = 0;
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        pages += 1;
        if (request.url.includes('page=1')) {
          return {
            status: 200,
            headers: { 'x-total-pages': '2' },
            text: JSON.stringify(
              Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `B${i + 1}` })),
            ),
          };
        }
        return {
          status: 200,
          headers: { 'x-total-pages': '2' },
          text: JSON.stringify([{ id: 51, name: 'B51' }]),
        };
      }),
    });
    const boards = await client.listBoards();
    expect(boards).toHaveLength(51);
    expect(pages).toBe(2);
  });

  it('stops board listing when pages repeat the same ids', async () => {
    let pages = 0;
    const samePage = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `B${i + 1}` }));
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport(() => {
        pages += 1;
        return { status: 200, text: JSON.stringify(samePage) };
      }),
    });
    const boards = await client.listBoards({ maxPages: 10 });
    expect(boards).toHaveLength(50);
    expect(pages).toBe(2); // first page + one duplicate page, then stop
  });

  it('testConnection only calls myself', async () => {
    const urls: string[] = [];
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        urls.push(request.url);
        return {
          status: 200,
          text: JSON.stringify({ id: 'u1', display: 'Ada' }),
        };
      }),
    });
    const result = await client.testConnection();
    expect(result.displayName).toBe('Ada');
    expect(urls).toEqual(['https://api.tracker.yandex.net/v3/myself']);
  });

  it('searches issues with query body', async () => {
    let body: string | undefined;
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        body = request.body;
        return {
          status: 200,
          text: JSON.stringify([
            { id: '1', key: 'doc-1', summary: 'Hello', tags: ['a'] },
          ]),
        };
      }),
    });
    const issues = await client.searchIssues('"Sprints By Board": 1');
    expect(JSON.parse(body ?? '{}')).toEqual({ query: '"Sprints By Board": 1' });
    expect(issues[0]?.key).toBe('DOC-1');
  });

  it('findIssueByExactSummary uses exact Summary phrase query', async () => {
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        if (request.url.includes('/issues/_search')) {
          expect(JSON.parse(request.body ?? '{}').query).toBe(
            'Queue: CL AND Summary: #"Shared title"',
          );
          return {
            status: 200,
            text: JSON.stringify([{ id: '1', key: 'CL-9', summary: 'Shared title' }]),
          };
        }
        return { status: 404, text: 'missing' };
      }),
    });
    const found = await client.findIssueByExactSummary('CL', 'Shared title');
    expect(found?.key).toBe('CL-9');
  });

  it('findIssuesByKeys searches by Key: then falls back to GET', async () => {
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        if (request.url.includes('/issues/_search')) {
          expect(JSON.parse(request.body ?? '{}').query).toContain('Key: CL-448');
          return {
            status: 200,
            text: JSON.stringify([{ id: '1', key: 'CL-448', summary: 'Domain' }]),
          };
        }
        return { status: 404, text: 'missing' };
      }),
    });
    const found = await client.findIssuesByKeys(['CL-448', 'CL-999']);
    expect([...found.keys()]).toEqual(['CL-448']);
    expect(found.get('CL-448')?.summary).toBe('Domain');
  });

  it('listBoardIssuesForSync unions Sprints By Board with queue backlog and paused', async () => {
    const bodies: string[] = [];
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        if (request.url.includes('/boards/14/columns/')) {
          return {
            status: 200,
            text: JSON.stringify({
              id: 1,
              name: 'Blocked',
              statuses: [{ id: '9', key: 'blocked', display: 'Blocked' }],
            }),
          };
        }
        if (request.url.includes('/boards/14') && request.method === 'GET') {
          return {
            status: 200,
            text: JSON.stringify({
              id: 14,
              name: 'Ops',
              defaultQueue: { key: 'OPS' },
              columns: [{ id: 1, display: 'Blocked' }],
            }),
          };
        }
        if (request.url.includes('/issues/_search')) {
          bodies.push(request.body ?? '');
          const query = String(JSON.parse(request.body ?? '{}').query ?? '');
          if (query.includes('Sprints By Board')) {
            return {
              status: 200,
              text: JSON.stringify([{ id: '1', key: 'OPS-1', summary: 'In sprint' }]),
            };
          }
          if (query.includes('Status Type') && query.includes('paused')) {
            return {
              status: 200,
              text: JSON.stringify([{ id: '3', key: 'OPS-3', summary: 'Blocked card' }]),
            };
          }
          if (query.includes('Queue:')) {
            return {
              status: 200,
              text: JSON.stringify([
                { id: '1', key: 'OPS-1', summary: 'In sprint' },
                { id: '2', key: 'OPS-2', summary: 'Backlog todo' },
              ]),
            };
          }
          return { status: 200, text: '[]' };
        }
        return { status: 404, text: 'missing' };
      }),
    });
    const issues = await client.listBoardIssuesForSync(14, {});
    expect(issues.map((issue) => issue.key).sort()).toEqual(['OPS-1', 'OPS-2', 'OPS-3']);
    expect(bodies.some((body) => String(JSON.parse(body).query ?? '').includes('Sprints By Board'))).toBe(
      true,
    );
    expect(bodies.some((body) => String(JSON.parse(body).query ?? '').includes('Status Type'))).toBe(
      true,
    );
  });

  it('creates and updates issues', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        calls.push({ method: request.method, url: request.url, body: request.body });
        if (request.method === 'POST' && request.url.endsWith('/issues')) {
          return {
            status: 201,
            text: JSON.stringify({ id: '1', key: 'DOC-9', summary: 'New' }),
          };
        }
        return {
          status: 200,
          text: JSON.stringify({ id: '1', key: 'DOC-9', summary: 'Updated' }),
        };
      }),
    });

    const created = await client.createIssue({
      queue: 'DOC',
      summary: 'New',
      tags: ['sync'],
      parentKey: 'DOC-1',
    });
    expect(created.key).toBe('DOC-9');

    await client.updateIssue('DOC-9', { summary: 'Updated', deadline: '2026-01-02' });
    expect(calls[1]?.method).toBe('PATCH');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toMatchObject({
      summary: 'Updated',
      deadline: '2026-01-02',
    });
  });

  it('executes transitions by target status key', async () => {
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        if (request.url.endsWith('/transitions') && request.method === 'GET') {
          return {
            status: 200,
            text: JSON.stringify([
              {
                id: 'close',
                to: { id: '3', key: 'closed', display: 'Closed' },
              },
            ]),
          };
        }
        if (request.url.includes('/_execute')) {
          expect(JSON.parse(request.body ?? '{}')).toEqual({ resolution: 'fixed' });
          return { status: 200, text: '[]' };
        }
        return { status: 404, text: 'missing' };
      }),
    });

    await client.transitionToStatus('DOC-1', 'closed', { resolution: 'fixed' });
  });

  it('walks multi-hop transitions toward a done status', async () => {
    let statusKey = 'open';
    const executed: string[] = [];
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport((request) => {
        if (request.url.endsWith('/transitions') && request.method === 'GET') {
          if (statusKey === 'open') {
            return {
              status: 200,
              text: JSON.stringify([
                {
                  id: 'start',
                  to: { id: '2', key: 'inProgress', display: 'In Progress' },
                },
              ]),
            };
          }
          if (statusKey === 'inProgress') {
            return {
              status: 200,
              text: JSON.stringify([
                {
                  id: 'close',
                  to: { id: '3', key: 'closed', display: 'Closed' },
                },
              ]),
            };
          }
          return { status: 200, text: '[]' };
        }
        if (request.url.includes('/_execute')) {
          const transitionId = request.url.split('/transitions/')[1]?.split('/')[0] ?? '';
          executed.push(transitionId);
          if (transitionId === 'start') {
            statusKey = 'inProgress';
            expect(JSON.parse(request.body ?? '{}')).toEqual({});
          }
          if (transitionId === 'close') {
            statusKey = 'closed';
            expect(JSON.parse(request.body ?? '{}')).toEqual({ resolution: 'fixed' });
          }
          return { status: 200, text: '[]' };
        }
        if (request.url.includes('/issues/DOC-1') && request.method === 'GET') {
          return {
            status: 200,
            text: JSON.stringify({
              id: '1',
              key: 'DOC-1',
              status: { id: '3', key: statusKey, display: 'Closed' },
            }),
          };
        }
        return { status: 404, text: 'missing' };
      }),
    });

    const moved = await client.transitionTowardStatuses('DOC-1', ['closed', '3'], {
      resolution: 'fixed',
    });
    expect(moved).toBe(true);
    expect(executed).toEqual(['start', 'close']);
  });

  it('throws TrackerApiError on HTTP failures', async () => {
    const client = new TrackerClient({
      apiBaseUrl: 'https://api.tracker.yandex.net',
      oauthToken: 'tok',
      orgId: 'org-1',
      orgIdHeader: 'X-Org-ID',
      transport: mockTransport(() => ({ status: 401, text: 'unauthorized' })),
    });
    await expect(client.getMyself()).rejects.toMatchObject({
      name: 'TrackerApiError',
      status: 401,
    } satisfies Partial<TrackerApiError>);
  });

  it('requires token and org id', () => {
    expect(
      () =>
        new TrackerClient({
          apiBaseUrl: 'https://api.tracker.yandex.net',
          oauthToken: '',
          orgId: 'org',
          orgIdHeader: 'X-Org-ID',
        }),
    ).toThrow(/OAuth token/i);
    expect(
      () =>
        new TrackerClient({
          apiBaseUrl: 'https://api.tracker.yandex.net',
          oauthToken: 'tok',
          orgId: '',
          orgIdHeader: 'X-Org-ID',
        }),
    ).toThrow(/organization ID/i);
  });
});
