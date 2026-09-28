import type { ReactElement } from 'react';
import { cx } from './classNames';
import { Tooltip } from './Tooltip';
import styles from './Avatar.module.css';

/** 24 tile, 28 nav, 32 modal, 40 menus (Section 2.1.2). */
export type AvatarSize = 24 | 28 | 32 | 40;

const SIZE_CLASS: Record<AvatarSize, string | undefined> = {
  24: undefined,
  28: styles.nav,
  32: styles.modal,
  40: styles.menu,
};

export interface AvatarProps {
  /** The user's full name; drives the initials and the accessible name. */
  name: string;
  /** `users.avatar_color` from the server — a runtime value, so it is an inline style. */
  color: string;
  size?: AvatarSize;
  /** Shows the full name on hover and keyboard focus. */
  tooltip?: boolean;
}

/** First and last initial, at most two characters. */
function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const second = last === undefined ? '' : last.slice(0, 1);
  return `${first.slice(0, 1)}${second}`.toUpperCase();
}

/** The initials circle. Colours come from the user row, never from a token. */
export function Avatar({ name, color, size = 24, tooltip = false }: AvatarProps): ReactElement {
  const circle = (
    <span
      className={cx(styles.avatar, SIZE_CLASS[size])}
      style={{ background: color }}
      role="img"
      aria-label={name}
    >
      {initials(name)}
    </span>
  );

  if (!tooltip) return circle;
  return <Tooltip content={name}>{circle}</Tooltip>;
}
