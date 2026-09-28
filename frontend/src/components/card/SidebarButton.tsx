import type { ReactElement, ReactNode } from 'react';
import { Tooltip } from '@/components/ui';
import { SHORTCUT_ANCHOR_ATTR } from '@/hooks/useKeyboardShortcuts';
import styles from './SidebarButton.module.css';

export interface SidebarButtonProps {
  /** The visible label, which is also the button's accessible name (Section 2.6.4). */
  label: string;
  /** A 16px lucide icon, rendered at the left of the label. */
  icon: ReactNode;
  /**
   * Receives the button element, because every sidebar row anchors its own popover to itself
   * (Section 2.6.4). A row without a handler is rendered disabled and explains itself through
   * `tooltip`; every row of the sidebar now has one.
   */
  onClick?: (anchor: HTMLElement) => void;
  /** Explains a disabled row, e.g. "Coming soon". */
  tooltip?: ReactNode;
  /**
   * The `data-shortcut-anchor` name of the row, for the three panels a key can open (`L`, `M`,
   * `D`): a keystroke has no `event.currentTarget`, so `hooks/useKeyboardShortcuts.ts` finds the
   * row by this attribute and the sidebar then renders its panel exactly as a click would.
   */
  shortcut?: string;
}

/**
 * One row of the card modal's sidebar (Section 2.6.4): full width, 32px, `--hover` fill, a
 * 16px icon at the left and the label in 14px 400. Every row that opens a popover hands its
 * own element to the parent as the anchor, so the panel lands beside the row that opened it.
 */
export function SidebarButton({
  label,
  icon,
  onClick,
  tooltip,
  shortcut,
}: SidebarButtonProps): ReactElement {
  const button = (
    <button
      type="button"
      className={styles.button}
      disabled={onClick === undefined}
      {...(shortcut === undefined ? {} : { [SHORTCUT_ANCHOR_ATTR]: shortcut })}
      onClick={(event) => onClick?.(event.currentTarget)}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
    </button>
  );

  if (tooltip === undefined) return button;
  // Section 2.6.4 anchors the sidebar's panels to the left of the column, so a row's tooltip
  // opens on the same side rather than over the button above it.
  return (
    <Tooltip content={tooltip} placement="left" className={styles.wrap}>
      {button}
    </Tooltip>
  );
}
