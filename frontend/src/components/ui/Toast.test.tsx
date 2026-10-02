import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Toast as QueuedToast } from '@/hooks/useToast';
import { TOAST_DURATION_MS, type ToastItem } from './Toast';
import { ToastViewport } from './ToastViewport';

// hooks/useToast.ts owns the queue and this viewport renders it, so a row of that queue
// must stay assignable to ToastItem. Drift in either shape fails `tsc --noEmit` here
// instead of silently rendering an error toast in the neutral colour.
const QUEUE_ROW_IS_RENDERABLE = (row: QueuedToast): ToastItem => row;

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastViewport', () => {
  it('renders a row straight off the useToast queue', () => {
    const onDismiss = vi.fn();
    const row = QUEUE_ROW_IS_RENDERABLE({ id: 7, message: 'Board reopened', tone: 'neutral' });
    render(<ToastViewport toasts={[row]} onDismiss={onDismiss} />);

    expect(screen.getByRole('status')).toHaveTextContent('Board reopened');
  });

  it('auto-dismisses each toast after five seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastViewport toasts={[{ id: 1, message: 'Board closed' }]} onDismiss={onDismiss} />);

    expect(screen.getByRole('status')).toHaveTextContent('Board closed');

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('runs the action and dismisses, and shows at most three toasts', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onClick = vi.fn();
    render(
      <ToastViewport
        toasts={[
          { id: 1, message: 'First' },
          { id: 2, message: 'Second' },
          { id: 3, message: 'Third' },
          { id: 4, message: 'Card archived', action: { label: 'Undo', onClick } },
        ]}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(4);
  });

  it('marks an error toast as an alert', () => {
    render(
      <ToastViewport
        toasts={[{ id: 5, message: 'Couldn\u2019t save changes.', tone: 'error' }]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\u2019t save changes.');
  });
});
