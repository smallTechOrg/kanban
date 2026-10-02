import { useState, type ReactElement, type ReactNode } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { cx } from './classNames';
import styles from './Tooltip.module.css';

/** 300ms hover delay (Section 2.1.2); keyboard focus shows it immediately. */
const HOVER_DELAY_MS = 300;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: Placement;
  /** Applied to the wrapper span, e.g. to let a full-width menu row keep its width. */
  className?: string;
}

/**
 * Wraps its child in an inline-flex reference span rather than cloning it, so a disabled
 * control (which fires no pointer events of its own) still gets a tooltip. React focus
 * events bubble, so keyboard focus on the child opens it too (Section 5.10).
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  className,
}: TooltipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: HOVER_DELAY_MS, close: 0 }, move: false }),
    useFocus(context),
    // `bubbles.escapeKey` keeps the Escape that closed the tooltip travelling: Floating UI stops
    // it by default, and a tooltip is not a layer anything is trapped in — the button a modal
    // hands focus to on open carries one, so swallowing that key made the first Escape a no-op
    // instead of closing the dialog (Section 2.6.1).
    useDismiss(context, { referencePress: true, bubbles: { escapeKey: true } }),
    useRole(context, { role: 'tooltip' }),
  ]);

  return (
    <>
      <span
        className={cx(styles.trigger, className)}
        ref={refs.setReference}
        {...getReferenceProps()}
      >
        {children}
      </span>
      {open ? (
        <FloatingPortal>
          <div
            className={styles.tooltip}
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
