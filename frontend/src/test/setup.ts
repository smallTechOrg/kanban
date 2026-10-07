import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Testing Library's own `findBy*` / `waitFor` budget is 1000ms and is separate from vitest's
// `testTimeout` (20s, raised in vitest.config.ts for the same reason): a card-modal case that
// waits on an msw round trip plus a TanStack mutation passes alone and loses the race in the
// 74-file run, failing a different test each time. The budget still cannot hide a hung test -
// vitest's per-test timeout ends that one - it only stops a loaded machine from deciding which
// assertion fails.
configure({ asyncUtilTimeout: 5000 });

// An unhandled request is a bug in the test, not something to fall through to the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// jsdom implements no layout, so it has no scrollIntoView. The composers of Section 2.4.4 call
// it on every submit; the stub keeps that a no-op instead of a TypeError.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // Layout-only behaviour: nothing to simulate.
  };
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => server.close());
