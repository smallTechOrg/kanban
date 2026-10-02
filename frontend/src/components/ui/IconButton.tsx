import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cx } from './classNames';
import { Tooltip } from './Tooltip';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** Non-optional by design (Section 5.10): an icon button always has an accessible name. */
  label: string;
  /** A 16px lucide-react icon. */
  children: ReactNode;
  /** 32x32 by default, 28x28 for dense rows (Section 2.1.2). */
  size?: 'md' | 'sm';
  /** `white` for the board header and top nav, where the icon sits on a dark fill. */
  tone?: 'default' | 'white';
  /** Tooltip body; defaults to `label`. `false` suppresses it (nested inside a tooltip). */
  tooltip?: ReactNode | false;
}

/**
 * A square icon-only button. Section 5.10 requires every one of them to carry an
 * `aria-label` and a tooltip, so both come from the same required `label` prop.
 */
export function IconButton({
  label,
  children,
  size = 'md',
  tone = 'default',
  tooltip,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cx(
        styles.button,
        size === 'sm' && styles.sm,
        tone === 'white' && styles.white,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );

  if (tooltip === false) return button;
  return <Tooltip content={tooltip ?? label}>{button}</Tooltip>;
}
