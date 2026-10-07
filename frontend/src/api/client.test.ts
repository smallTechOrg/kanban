import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/test/server';
import { ApiError, api } from './client';

/** The envelope every failure carries (Section 4.1). */
function envelope(code: string, message: string): Record<string, unknown> {
  return { error: { code, message, request_id: 'req-1', details: null } };
}

/**
 * `Retry-After: 0` is the documented header with the wait taken out of it, so the retry rule
 * can be asserted without a real second of sleeping. An absent header means one second.
 */
function busy() {
  return HttpResponse.json(envelope('lock_timeout', 'The space is busy.'), {
    status: 503,
    headers: { 'Retry-After': '0' },
  });
}

describe('api client', () => {
  it('retries a 503 once, after Retry-After, and returns the second answer', async () => {
    let attempts = 0;
    server.use(
      http.post('/api/lists/11/cards', () => {
        attempts += 1;
        return attempts === 1 ? busy() : HttpResponse.json({ ok: true });
      }),
    );

    await expect(api.post('/lists/11/cards', { title: 'Retry me' })).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('gives up after that one retry, so the caller can roll back', async () => {
    let attempts = 0;
    server.use(
      http.post('/api/lists/11/cards', () => {
        attempts += 1;
        return busy();
      }),
    );

    await expect(api.post('/lists/11/cards', { title: 'Retry me' })).rejects.toMatchObject({
      status: 503,
    });
    // Exactly one retry: a board that stays busy must not queue requests behind itself.
    expect(attempts).toBe(2);
  });

  it('does not retry any other failure', async () => {
    let attempts = 0;
    server.use(
      http.post('/api/lists/11/cards', () => {
        attempts += 1;
        return HttpResponse.json(envelope('conflict', 'Board is closed.'), { status: 409 });
      }),
    );

    const error = await api
      .post('/lists/11/cards', { title: 'Nope' })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect(attempts).toBe(1);
  });
});
