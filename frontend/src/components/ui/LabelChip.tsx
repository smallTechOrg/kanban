import type { ReactElement, ReactNode } from 'react';
import { labelPatternIndex, labelStyle, type LabelPalette, type LabelTone } from '@/lib/colors';
import { cx } from './classNames';
import styles from './LabelChip.module.css';

/** The two chip shapes of the plan: the 16px bar on a tile and the 32px pill everywhere else. */
export type LabelChipSize = 'tile' | 'large';

/** How many stripe patterns the colourblind mode has; the palette publishes ten keys. */
const PATTERNS = 10;

export interface LabelChipProps {
  /** The label's name. An unnamed label (the six a board is seeded with) shows its colour key. */
  name: string;
  /** A `label_colors` key from `GET /api/meta`, including `none` (Section 2.9.2). */
  color: string;
  tone: LabelTone;
  /** `meta.label_colors`: the only source of the thirty hexes (CLAUDE.md section 3). */
  palette: LabelPalette;
  size?: LabelChipSize;
  /** Tile size only: the global label-text mode shows the name inside the bar (Section 2.5.2). */
  showText?: boolean;
  /** `uiStore.colorBlindLabels`: adds the key's diagonal-stripe pattern (Section 2.6.5). */
  patterned?: boolean;
  /** Makes the chip a button — the tile toggles the text mode, a popover row the label. */
  onClick?: () => void;
  /** Sets `aria-pressed` on a toggling chip, e.g. a `LabelsPopover` row. */
  pressed?: boolean;
  /** Rendered at the chip's right edge, e.g. the check icon of a selected popover row. */
  children?: ReactNode;
  /** Lets a caller stretch the chip, e.g. `flex: 1` inside a `LabelsPopover` row. */
  className?: string;
}

/**
 * One label chip (Sections 2.5.2 and 2.6.3). It is the only place a label's two colours are
 * applied: `lib/colors.ts` resolves the `{color, tone}` pair against the server palette, so
 * the tile, the modal's badge row and both label popovers cannot drift apart.
 *
 * The colours are an inline style because they are a runtime value from `GET /api/meta`, which
 * is exactly the exception Section 5 of CLAUDE.md allows. The colourblind mode's stripes are
 * not: the pattern is a class chosen by the key's slot in that palette, so the angles stay in
 * the stylesheet and the ten keys stay ten distinguishable patterns.
 *
 * That inline fill is `backgroundColor`, never the `background` shorthand. The shorthand resets
 * `background-image` to `none`, and an inline declaration outranks a class, so it silently wiped
 * out the stripe the `.stripeN` class had just painted: the colourblind mode of Section 2.6.5
 * set its flag, its class and its `localStorage` key and changed nothing a reader could see.
 */
export function LabelChip({
  name,
  color,
  tone,
  palette,
  size = 'tile',
  showText = false,
  patterned = false,
  onClick,
  pressed,
  children,
  className,
}: LabelChipProps): ReactElement {
  const label = name === '' ? color : name;
  const { background, color: text } = labelStyle(color, tone, palette);
  const pattern = patterned ? labelPatternIndex(color, palette) % PATTERNS : -1;
  const chipClass = cx(
    styles.chip,
    size === 'large' ? styles.large : styles.tile,
    size === 'tile' && showText && styles.tileText,
    pattern >= 0 && styles[`stripe${String(pattern)}`],
    className,
  );
  const withText = size === 'large' || showText;
  const body = (
    <>
      {withText ? <span className={styles.name}>{label}</span> : null}
      {children}
    </>
  );

  if (onClick === undefined) {
    return (
      <span
        className={chipClass}
        style={{ backgroundColor: background, color: text }}
        title={label}
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={chipClass}
      style={{ backgroundColor: background, color: text }}
      title={label}
      aria-label={`Label ${label}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
