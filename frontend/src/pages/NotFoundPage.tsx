import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, MessagePanel } from '@/components/ui';

export interface NotFoundPageProps {
  /** Section 2.10: a 404 board reuses this page with its own copy. */
  title?: string;
  body?: string;
}

/** Any unmatched path inside the app shell (Section 5.2), and a board that 404s (2.10). */
export function NotFoundPage({
  title = 'Page not found',
  body = 'That page does not exist.',
}: NotFoundPageProps): ReactElement {
  const navigate = useNavigate();

  return (
    <MessagePanel title={title}>
      <p>{body}</p>
      <Button variant="primary" onClick={() => navigate('/')}>
        Back to spaces
      </Button>
    </MessagePanel>
  );
}
