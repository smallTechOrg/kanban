/**
 * The only place a date is turned into text (CLAUDE.md section 3).
 * Formats follow Section 2.5.1: "Sep 24", "Sep 24 at 3:00 PM", "4 minutes ago".
 *
 * Every function takes an explicit `now` so callers (and tests) are deterministic.
 */
import { format, formatDistanceStrict, isValid, parseISO } from 'date-fns';

export type DateInput = string | number | Date;

const DAY = 'MMM d';
const DAY_WITH_YEAR = 'MMM d, yyyy';
const TIME = 'h:mm a';

/** Below this, date-fns would say "0 seconds ago"; Trello says "just now". */
const JUST_NOW_MS = 45_000;

/** Parses an API timestamp (ISO-8601 UTC), an epoch or a Date. Null when unparseable. */
function toDate(value: DateInput): Date | null {
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  return isValid(date) ? date : null;
}

/** "Sep 24", or "Sep 24, 2025" when the date is not in the current year. */
export function formatDate(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (date === null) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? DAY : DAY_WITH_YEAR);
}

/** "Sep 24 at 3:00 PM" — the absolute form used in tooltips and attachment meta lines. */
export function formatDateTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (date === null) return '';
  return `${formatDate(date, now)} at ${format(date, TIME)}`;
}

/** "just now", "4 minutes ago", "in 2 hours" — the relative time every activity row shows. */
export function relativeTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (date === null) return '';
  if (Math.abs(now.getTime() - date.getTime()) < JUST_NOW_MS) return 'just now';
  return formatDistanceStrict(date, now, { addSuffix: true });
}

/** `<input type="date">` and `<input type="time">` speak these two shapes, in local time. */
const DATE_VALUE = 'yyyy-MM-dd';
const TIME_VALUE = 'HH:mm';

/** What `<input type="date">` / `<input type="time">` accept: `2026-09-25` / `12:00`. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** Section 2.6.5: a freshly ticked due date defaults to tomorrow at noon, local time. */
const NOON = 12;

/** `2026-09-25` for a `<input type="date">`, in the browser's own timezone. */
export function dateInputValue(value: DateInput): string {
  const date = toDate(value);
  return date === null ? '' : format(date, DATE_VALUE);
}

/** `15:00` for a `<input type="time">`, in the browser's own timezone. */
export function timeInputValue(value: DateInput): string {
  const date = toDate(value);
  return date === null ? '' : format(date, TIME_VALUE);
}

/**
 * The two date inputs of `DatesPopover` as the ISO-8601 UTC string the API stores: both
 * fields are read as browser-local wall time and converted on the way out (Section 2.6.5).
 * Null when either field is empty or malformed, which is what an untouched input holds.
 */
export function toUtcIso(date: string, time: string): string | null {
  const day = DATE_PATTERN.exec(date);
  const clock = TIME_PATTERN.exec(time);
  if (day === null || clock === null) return null;
  const local = new Date(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  return local.toISOString();
}

/** Tomorrow at 12:00 PM local — the date the first "Due date" tick offers (Section 2.6.5). */
export function tomorrowNoon(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, NOON, 0);
}
