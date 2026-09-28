import { describe, expect, it } from 'vitest';
import {
  dateInputValue,
  formatDate,
  formatDateTime,
  relativeTime,
  timeInputValue,
  toUtcIso,
  tomorrowNoon,
} from './dates';

// Dates are built with local-time constructors so the assertions hold in any timezone.
const NOW = new Date(2026, 8, 24, 18, 0, 0); // 24 Sep 2026, 18:00 local

describe('formatDate', () => {
  it('omits the year inside the current year', () => {
    expect(formatDate(new Date(2026, 8, 24), NOW)).toBe('Sep 24');
  });

  it('adds the year for another year', () => {
    expect(formatDate('2025-09-24', NOW)).toBe('Sep 24, 2025');
  });

  it('accepts an epoch timestamp', () => {
    expect(formatDate(new Date(2026, 0, 3).getTime(), NOW)).toBe('Jan 3');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDate('not-a-date', NOW)).toBe('');
  });

  it('defaults to the current clock', () => {
    const today = new Date();
    expect(formatDate(today)).toBe(formatDate(today, today));
  });
});

describe('formatDateTime', () => {
  it('renders the absolute day and time', () => {
    expect(formatDateTime(new Date(2026, 8, 24, 15, 0), NOW)).toBe('Sep 24 at 3:00 PM');
  });

  it('carries the year across into the long form', () => {
    expect(formatDateTime(new Date(2025, 8, 24, 9, 30), NOW)).toBe('Sep 24, 2025 at 9:30 AM');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatDateTime('nope', NOW)).toBe('');
  });

  it('defaults to the current clock', () => {
    const today = new Date();
    expect(formatDateTime(today)).toBe(formatDateTime(today, today));
  });
});

describe('relativeTime', () => {
  it('collapses the last few seconds to "just now"', () => {
    expect(relativeTime(new Date(NOW.getTime() - 10_000), NOW)).toBe('just now');
  });

  it('describes a past moment', () => {
    expect(relativeTime(new Date(NOW.getTime() - 4 * 60_000), NOW)).toBe('4 minutes ago');
  });

  it('describes a future moment', () => {
    expect(relativeTime(new Date(NOW.getTime() + 2 * 3_600_000), NOW)).toBe('in 2 hours');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(relativeTime('', NOW)).toBe('');
  });

  it('defaults to the current clock', () => {
    expect(relativeTime(new Date())).toBe('just now');
  });
});

describe('dateInputValue', () => {
  it('renders the local calendar day an <input type="date"> accepts', () => {
    expect(dateInputValue(new Date(2026, 8, 24, 23, 30))).toBe('2026-09-24');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(dateInputValue('nope')).toBe('');
  });
});

describe('timeInputValue', () => {
  it('renders the local wall time an <input type="time"> accepts', () => {
    expect(timeInputValue(new Date(2026, 8, 24, 15, 5))).toBe('15:05');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(timeInputValue('nope')).toBe('');
  });
});

describe('toUtcIso', () => {
  it('reads both fields as local wall time and answers a UTC instant', () => {
    const local = new Date(2026, 8, 24, 15, 0);
    expect(toUtcIso('2026-09-24', '15:00')).toBe(local.toISOString());
  });

  it('answers null for an empty date, which is what an untouched input holds', () => {
    expect(toUtcIso('', '15:00')).toBeNull();
  });

  it('answers null for a malformed time', () => {
    expect(toUtcIso('2026-09-24', '3 PM')).toBeNull();
  });
});

describe('tomorrowNoon', () => {
  it('is the next calendar day at 12:00 local', () => {
    const next = tomorrowNoon(NOW);
    expect(dateInputValue(next)).toBe('2026-09-25');
    expect(timeInputValue(next)).toBe('12:00');
  });

  it('defaults to the current clock', () => {
    expect(timeInputValue(tomorrowNoon())).toBe('12:00');
  });
});
