import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  diffInDays,
  endOfMonth,
  isCivilDate,
  startOfMonth,
  startOfWeek,
  weekdayOf,
} from '../civil-date.js';

describe('isCivilDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isCivilDate('2026-02-28')).toBe(true);
    expect(isCivilDate('2024-02-29')).toBe(true); // leap year
    expect(isCivilDate('2026-02-29')).toBe(false); // not a leap year
    expect(isCivilDate('2026-13-01')).toBe(false);
    expect(isCivilDate('2026-04-31')).toBe(false);
    expect(isCivilDate('26-01-01')).toBe(false);
    expect(isCivilDate(20260101)).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps when adding months to a month-end date', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('clamps 29 February when adding years', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('computes day differences', () => {
    expect(diffInDays('2026-01-01', '2026-01-31')).toBe(30);
    expect(diffInDays('2026-01-31', '2026-01-01')).toBe(-30);
  });
});

describe('boundaries', () => {
  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('finds month boundaries', () => {
    expect(startOfMonth('2026-02-17')).toBe('2026-02-01');
    expect(endOfMonth('2026-02-17')).toBe('2026-02-28');
  });

  it('finds the start of the week for both conventions', () => {
    // 2026-01-07 is a Wednesday.
    expect(startOfWeek('2026-01-07', 1)).toBe('2026-01-05'); // Monday
    expect(startOfWeek('2026-01-07', 0)).toBe('2026-01-04'); // Sunday
  });

  it('reports weekdays with Sunday as 0', () => {
    expect(weekdayOf('2026-01-04')).toBe(0);
    expect(weekdayOf('2026-01-05')).toBe(1);
  });
});
