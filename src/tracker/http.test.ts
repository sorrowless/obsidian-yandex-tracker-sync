import { describe, expect, it, vi } from 'vitest';
import { createFetchTransport, createObsidianRequestTransport } from './http';

describe('http transports', () => {
  it('wraps fetch', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => '{"ok":true}',
    })) as unknown as typeof fetch;

    const transport = createFetchTransport(fetchImpl);
    const response = await transport({
      url: 'https://api.tracker.yandex.net/v3/myself',
      method: 'GET',
      headers: { Authorization: 'OAuth x' },
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api.tracker.yandex.net/v3/myself', {
      method: 'GET',
      headers: { Authorization: 'OAuth x' },
      body: undefined,
    });
    expect(response.status).toBe(200);
    expect(response.text).toBe('{"ok":true}');
  });

  it('wraps Obsidian requestUrl and omits undefined body', async () => {
    const requestUrlFn = vi.fn(async () => ({
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      text: '{"key":"DOC-1"}',
    }));

    const transport = createObsidianRequestTransport(requestUrlFn);
    const response = await transport({
      url: 'https://api.tracker.yandex.net/v3/issues',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    expect(requestUrlFn).toHaveBeenCalledTimes(1);
    const called = requestUrlFn.mock.calls.at(0)?.at(0) as Record<string, unknown> | undefined;
    expect(called).toBeTruthy();
    expect(called).toMatchObject({
      url: 'https://api.tracker.yandex.net/v3/issues',
      method: 'GET',
      headers: { Accept: 'application/json' },
      throw: false,
    });
    expect(called).not.toHaveProperty('body');
    expect(response.status).toBe(201);
    expect(response.text).toBe('{"key":"DOC-1"}');
  });

  it('passes body only when set', async () => {
    const requestUrlFn = vi.fn(async () => ({
      status: 201,
      headers: {},
      text: '{}',
    }));
    const transport = createObsidianRequestTransport(requestUrlFn);
    await transport({
      url: 'https://api.tracker.yandex.net/v3/issues',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"summary":"x"}',
    });
    expect(requestUrlFn).toHaveBeenCalledWith({
      url: 'https://api.tracker.yandex.net/v3/issues',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"summary":"x"}',
      throw: false,
    });
  });

  it('times out when requestUrl never settles', async () => {
    const requestUrlFn = vi.fn(
      () => new Promise<{ status: number; headers: Record<string, string>; text: string }>(() => {}),
    );
    const transport = createObsidianRequestTransport(requestUrlFn, { timeoutMs: 30 });
    await expect(
      transport({
        url: 'https://api.tracker.yandex.net/v3/myself',
        method: 'GET',
        headers: {},
      }),
    ).rejects.toThrow(/timed out after 30ms/i);
  });
});
