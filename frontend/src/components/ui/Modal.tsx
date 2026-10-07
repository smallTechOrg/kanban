import { useId, type ReactElement, type ReactNode } from 'react';
import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { X } from 'lucide-react';
import { cx } from './classNames';
import { IconButton } from './IconButton';
import styles from './Modal.module.css';

export interface ModalProps {
  /** The accessible name. Rendered as the heading unless `chrome` is false. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Overrides the 768px default (a runtime value, so it is an inline style). */
  width?: number;
  /** `false` drops the header so a caller can draw its own (the card modal does). */
  chrome?: boolean;
  /**
   * `true` drops the body padding. The card modal's two columns carry their own
   * (552px + 168px + `0 8px 8px 16px` and `0 16px 8px 8px` = the 768px dialog, Section 2.6.3),
   * so a padding here would make that arithmetic overflow, and its cover strip bleeds to the
   * dialog's edges.
   */
  flush?: boolean;
}

/**
 * Portalled dialog: overlay in `--overlay`, centred panel, Escape and backdrop dismissal,
 * trapped focus, body scroll lock and focus restored to the trigger (Section 5.10).
 *
 * Like `Popover` it is controlled — rendering it means it is open.
 */
export function Modal({
  title,
  onClose,
  children,
  width,
  chrome = true,
  flush = false,
}: ModalProps): ReactElement {
  const titleId = useId();
  const { refs, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });
  const { getFloatingProps } = useInteractions([
    useDismiss(context, { escapeKey: true, outsidePress: true }),
    useRole(context, { role: 'dialog' }),
  ]);

  return (
    <FloatingPortal>
      <FloatingOverlay className={styles.overlay} lockScroll>
        <FloatingFocusManager context={context} modal>
          <div
            ref={refs.setFloating}
            className={styles.panel}
            style={width === undefined ? undefined : { width }}
            aria-modal="true"
            aria-label={chrome ? undefined : title}
            aria-labelledby={chrome ? titleId : undefined}
            {...getFloatingProps()}
          >
            {chrome ? (
              <div className={styles.header}>
                <h2 className={styles.title} id={titleId}>
                  {title}
                </h2>
                <IconButton label="Close" onClick={onClose}>
                  <X aria-hidden="true" />
                </IconButton>
              </div>
            ) : null}
            <div className={cx(styles.body, flush && styles.bodyFlush)}>{children}</div>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
