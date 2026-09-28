/** The public endpoint the SPA reads before it authenticates (Section 4.7). */
import { api } from './client';
import type { Meta } from './types';

/** Palettes, limits and flags. Public: the login page reads it before authenticating. */
export function getMeta(): Promise<Meta> {
  return api.get<Meta>('/meta');
}
