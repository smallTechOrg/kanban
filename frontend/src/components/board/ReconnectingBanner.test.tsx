import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@/store/uiStore';
import { ReconnectingBanner } from './ReconnectingBanner';

/** `navigator.onLine` is a getter in jsdom, so the offline case is stubbed rather than set. */
function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

describe('ReconnectingBanner', () => {
  beforeEach(() => {
    setOnline(true);
    useUiStore.getState().setRealtimeStatus('live');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays out of the way while the stream is live or merely reconnecting', () => {
    render(<ReconnectingBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => useUiStore.getState().setRealtimeStatus('reconnecting'));

    // Section 2.10: the banner appears only at the third failed reconnect, i.e. while polling.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears while polling and goes away on the next hello', () => {
    render(<ReconnectingBanner />);

    act(() => useUiStore.getState().setRealtimeStatus('polling'));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    act(() => useUiStore.getState().setRealtimeStatus('live'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says so when the browser is offline', () => {
    render(<ReconnectingBanner />);

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      "You're offline. Changes will fail until you reconnect.",
    );

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
