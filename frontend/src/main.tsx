import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes';
import { initTheme } from '@/store/uiStore';
import '@/styles/tokens.css';
import '@/styles/global.css';

// Before the first paint, so a dark or classic theme never flashes light (Section 5.6).
initTheme();

/**
 * The defaults of Section 5.4.1: one retry for queries, none for mutations, and a refetch
 * when the window regains focus.
 *
 * There is deliberately no global `staleTime`: Section 5.4.1 gives every key its own
 * (`['me']` and `['meta']` Infinity, `['board', id]` 30 s, `['lists', id]` 10 s), and a
 * blanket 30 s froze the keys that ask for none — `['boards']` kept serving the groups it
 * had when a board was created, so a board opened after that never reached "Recently
 * viewed" until a full page reload.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing the #root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
