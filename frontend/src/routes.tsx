import { createBrowserRouter } from 'react-router-dom';
import { CardDetailModal } from '@/components/card/CardDetailModal';
import { AppShell } from '@/components/shell/AppShell';
import { BoardPage } from '@/pages/BoardPage';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';

/**
 * The route table of Section 5.2. Ids in URLs are plain integers (`/b/12/c/341`).
 *
 * Every route renders inside `<AppShell>`, which draws the nav around the routed page.
 *
 * `b/:boardId/c/:cardId` is a child of the board route, not a sibling: the modal renders
 * through `BoardPage`'s `<Outlet>` so the board is painted underneath it even on a direct
 * load, and the browser Back button closes the card rather than leaving the app (Section 5.2).
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'b/:boardId',
        element: <BoardPage />,
        children: [{ path: 'c/:cardId', element: <CardDetailModal /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
