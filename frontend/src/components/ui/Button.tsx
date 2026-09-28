import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cx } from './classNames';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

/** The five variants of Section 2.1.2. `subtle` text actions use `link`. */
export type ButtonVariant = 'primary' | 'default' | 'danger' | 'link' | 'transparent-white';

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  default: styles.default,
  danger: styles.danger,
  link: styles.link,
  'transparent-white': styles.transparentWhite,
};

const ON_DARK: Record<ButtonVariant, boolean> = {
  primary: true,
  default: false,
  danger: true,
  link: false,
  'transparent-white': true,
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  /** Swaps the label for a spinner and blocks further clicks. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Rendered at the left of the label, e.g. a 16px lucide icon. */
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * Every text button in the app. All variants are 32px tall (Section 2.1.2), so there is no
 * size prop: dense icon-only affordances are `IconButton size="sm"`.
 */
export function Button({
  variant = 'default',
  loading = false,
  fullWidth = false,
  icon,
  children,
  className,
  disabled = false,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        VARIANT_CLASS[variant],
        fullWidth && styles.fullWidth,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} onDark={ON_DARK[variant]} /> : icon}
      {children}
    </button>
  );
}
