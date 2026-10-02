import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** The mock API. Tests override a single route with `server.use(...)`. */
export const server = setupServer(...handlers);
