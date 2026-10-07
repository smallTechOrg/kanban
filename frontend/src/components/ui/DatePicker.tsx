import type { ReactElement } from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import 'react-day-picker/style.css';
import styles from './DatePicker.module.css';

export type DatePickerProps = DayPickerProps;

/**
 * The `react-day-picker` month view of Section 2.6.5, dressed in the Section 2.9.1 tokens.
 *
 * Two panels show a calendar — `DatesPopover` (single day or a start-to-due range) and
 * `ItemDuePopover` (a single day) — and the library's own stylesheet needs the same handful of
 * variables remapped in both, so the chrome lives here once rather than in each panel's CSS
 * module. Every prop is the library's own, so a caller still chooses `mode` and passes
 * `selected` / `onSelect` exactly as `react-day-picker` documents them.
 */
export function DatePicker(props: DatePickerProps): ReactElement {
  return (
    <div className={styles.calendar}>
      <DayPicker {...props} />
    </div>
  );
}
