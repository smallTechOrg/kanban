import { useState, type ReactElement } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { cx } from '@/components/ui';
import styles from './BackgroundPicker.module.css';

/** A preset background: a hex from `meta.board_colors` or a `meta.board_gradients` key. */
export interface BackgroundChoice {
  type: 'color' | 'gradient';
  value: string;
}

export interface BackgroundPickerProps {
  /** `meta.board_colors` — nine hexes, six of them shown until "…" is pressed. */
  colors: Readonly<Record<string, string>>;
  /** `meta.board_gradients` — the four gradient thumbnails of row 1. */
  gradients: Readonly<Record<string, string>>;
  value: BackgroundChoice | null;
  onChange: (choice: BackgroundChoice) => void;
  /** Section 2.2.1: the preview follows the pointer and commits only on click. */
  onPreview: (choice: BackgroundChoice | null) => void;
}

/** Section 2.2.1: six of the nine colours until the "…" swatch expands the row. */
const COLLAPSED_COLORS = 6;

/** `gradient-ocean` -> "Ocean gradient", `blue` -> "Blue"; the keys come from the server. */
function swatchName(key: string): string {
  const bare = key.replace('gradient-', '');
  const titled = bare.charAt(0).toUpperCase() + bare.slice(1);
  return key.startsWith('gradient-') ? `${titled} gradient` : titled;
}

function isSame(left: BackgroundChoice | null, right: BackgroundChoice): boolean {
  return left !== null && left.type === right.type && left.value === right.value;
}

/**
 * The preset background picker of the create-board popover (Section 2.2.1): four gradient
 * thumbnails, then the colour swatches. Every value comes from `GET /api/meta`, so the
 * palette lives in exactly one place (CLAUDE.md section 3).
 *
 * The "Custom" upload swatch of Section 2.2.1 is not here: uploading needs the board to
 * exist (`POST /api/boards/{board_id}/background`), and `api/boards.ts` has no upload call
 * yet. It arrives with `BoardBackgroundPicker` in M3 (Section 2.3.4).
 */
export function BackgroundPicker({
  colors,
  gradients,
  value,
  onChange,
  onPreview,
}: BackgroundPickerProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const colorEntries = Object.entries(colors);
  const gradientEntries = Object.entries(gradients);
  const collapsed = !expanded && colorEntries.length > COLLAPSED_COLORS;

  function swatch(
    key: string,
    choice: BackgroundChoice,
    background: string,
    className: string | undefined,
  ): ReactElement {
    const selected = isSame(value, choice);
    return (
      <button
        key={key}
        type="button"
        aria-label={`${swatchName(key)} background`}
        aria-pressed={selected}
        className={cx(styles.swatch, className)}
        style={choice.type === 'gradient' ? { backgroundImage: background } : { background }}
        onClick={() => onChange(choice)}
        onMouseEnter={() => onPreview(choice)}
        onMouseLeave={() => onPreview(null)}
        onFocus={() => onPreview(choice)}
        onBlur={() => onPreview(null)}
      >
        {selected ? <Check className={styles.check} aria-hidden="true" /> : null}
      </button>
    );
  }

  return (
    <div className={styles.picker}>
      <p className={styles.label}>Background</p>
      <div className={styles.row}>
        {gradientEntries.map(([key, css]) =>
          swatch(key, { type: 'gradient', value: key }, css, styles.gradient),
        )}
      </div>
      <div className={styles.row}>
        {(collapsed ? colorEntries.slice(0, COLLAPSED_COLORS) : colorEntries).map(([key, hex]) =>
          swatch(key, { type: 'color', value: hex }, hex, styles.color),
        )}
        {collapsed ? (
          <button
            type="button"
            aria-label="Show all background colours"
            className={cx(styles.swatch, styles.color, styles.more)}
            onClick={() => setExpanded(true)}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
