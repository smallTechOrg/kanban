import { createBrowserRouter, Navigate } from 'react-router-dom';
import { CardDetailModal } from '@/components/card/CardDetailModal';
import { AppShell } from '@/components/shell/AppShell';
import { BoardPage } from '@/pages/BoardPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';
import { WorkspaceMembersPage } from '@/pages/WorkspaceMembersPage';
import { WorkspaceSettingsPage } from '@/pages/WorkspaceSettingsPage';

/**
 * The route table of Section 5.2. Ids in URLs are plain integers (`/b/12/c/341`).
 *
 * Everything except `/login` and `/register` renders inside `<AppShell>`, which resolves
 * GET /api/auth/me once and redirects to /login?next=<path> on 401.
 *
 * `b/:boardId/c/:cardId` is a child of the board route, not a sibling: the modal renders
 * through `BoardPage`'s `<Outlet>` so the board is painted underneath it even on a direct
 * load, and the browser Back button closes the card rather than leaving the app (Section 5.2).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'boards', element: <Navigate to="/" replace /> },
      { path: 'w/members', element: <WorkspaceMembersPage /> },
      { path: 'w/settings', element: <WorkspaceSettingsPage /> },
      {
        path: 'b/:boardId',
        element: <BoardPage />,
        children: [{ path: 'c/:cardId', element: <CardDetailModal /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
