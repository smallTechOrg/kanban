import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';
import { Popover } from './Popover';
import styles from './ConfirmPopover.module.css';

export interface ConfirmPopoverProps {
  /** The element the popover hangs off — usually the danger button that opened it. */
  anchor: HTMLElement | DOMRect;
  /** Question form, e.g. "Delete space?" (Sections 2.3.5 and 2.6.4). */
  title: string;
  body: ReactNode;
  /** Label of the red button; "Delete" by default. */
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}

/**
 * The destructive confirmation of Section 2.3.5: a `Popover` with a warning body and one
 * full-width `danger` button. Closing is left to the caller, whose handler usually navigates
 * away once the request resolves.
 */
export function ConfirmPopover({
  anchor,
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
  loading = false,
}: ConfirmPopoverProps): ReactElement {
  return (
    <Popover anchor={anchor} title={title} onClose={onClose}>
      <p className={styles.body}>{body}</p>
      <Button variant="danger" fullWidth loading={loading} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </Popover>
  );
}
