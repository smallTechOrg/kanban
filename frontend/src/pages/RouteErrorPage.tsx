import type { ReactElement } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { MessagePanel } from '@/components/ui/MessagePanel';

/** Rendered by the router when a route throws (Section 5.2 `errorElement`). */
export function RouteErrorPage(): ReactElement {
  const error: unknown = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return (
    <MessagePanel title="Something went wrong">
      {detail}. Reload the page, or <a href="/">go back to your spaces</a>.
    </MessagePanel>
  );
}
