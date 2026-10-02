import { useEffect, useState, type ReactElement } from 'react';
import { useUiStore } from '@/store/uiStore';
import styles from './ReconnectingBanner.module.css';

/** Section 2.10's two sentences, word for word. */
const RECONNECTING = 'Reconnecting…';
const OFFLINE = "You're offline. Changes will fail until you reconnect.";

/**
 * The realtime banner of Section 2.10. It appears on exactly one trigger —
 * `uiStore.realtimeStatus === 'polling'`, which `api/events.ts` sets at the third failed
 * `EventSource` reconnect, the same moment it starts polling `/changes` — and it goes away on the
 * next `hello`. A browser that reports itself offline shows the same band with the offline
 * sentence, because then the stream is not coming back until the network does.
 *
 * The status itself is decided in one place (`api/events.ts`, mirrored into the store by
 * `useBoardEvents`); this component only paints it.
 */
export function ReconnectingBanner(): ReactElement | null {
  const status = useUiStore((state) => state.realtimeStatus);
  const [isOffline, setIsOffline] = useState(() => navigator.onLine === false);

  useEffect(() => {
    const onOffline = (): void => setIsOffline(true);
    const onOnline = (): void => setIsOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!isOffline && status !== 'polling') return null;
  return (
    <div className={styles.banner} role="status">
      {isOffline ? OFFLINE : RECONNECTING}
    </div>
  );
}
