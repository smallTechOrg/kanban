/** `GET /api/meta` — the palettes and limits every client reads (Section 4.7). */
import { api } from './client';
import type { Meta } from './types';

/** The palettes and the upload limit, read once on boot and never refetched. */
export function getMeta(): Promise<Meta> {
  return api.get<Meta>('/meta');
}
