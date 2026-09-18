import { describe, expect, it } from 'vitest';
import { friendlyDate, friendlyTime, overdueLabel, todayIn } from '../lib/format.js';

describe('friendlyDate', () => {
  const today = '2026-03-10'; // a Tuesday

  it('says what a person would say for nearby days', () => {
    expect(friendlyDate('2026-03-10', today)).toBe('Today');
    expect(friendlyDate('2026-03-11', today)).toBe('Tomorrow');
    expect(friendlyDate('2026-03-09', today)).toBe('Yesterday');
  });

  it('names the weekday within the coming week', () => {
    expect(friendlyDate('2026-03-13', today)).toBe('Friday');
  });

  it('falls back to a date once a weekday would be ambiguous', () => {
    expect(friendlyDate('2026-04-20', today)).toMatch(/20 Apr/);
  });

  it('includes the year only when it differs', () => {
    expect(friendlyDate('2027-04-20', today)).toMatch(/2027/);
    expect(friendlyDate('2026-04-20', today)).not.toMatch(/2026/);
  });

  it('counts back for older dates', () => {
    expect(friendlyDate('2026-03-01', today)).toBe('9 days ago');
  });
});

describe('friendlyTime', () => {
  it('renders 24-hour input in the locale’s clock convention', () => {
    expect(friendlyTime('14:30', 'en-US')).toMatch(/2:30/);
    expect(friendlyTime('09:00', 'en-GB')).toMatch(/09:00|9:00/);
  });
});

describe('overdueLabel', () => {
  it('phrases lateness for a person, not a log file', () => {
    expect(overdueLabel('2026-03-09', '2026-03-10')).toBe('Overdue by 1 day');
    expect(overdueLabel('2026-03-05', '2026-03-10')).toBe('Overdue by 5 days');
    expect(overdueLabel('2025-11-01', '2026-03-10')).toBe('Long overdue');
  });

  it('says nothing when the date has not passed', () => {
    expect(overdueLabel('2026-03-11', '2026-03-10')).toBe('');
    expect(overdueLabel('2026-03-10', '2026-03-10')).toBe('');
  });
});

describe('todayIn', () => {
  it('uses the household timezone, not the browser’s', () => {
    // 19:30Z is already the next day in Karachi.
    const instant = new Date('2026-03-01T19:30:00Z');
    expect(todayIn('Asia/Karachi', instant)).toBe('2026-03-02');
    expect(todayIn('Europe/London', instant)).toBe('2026-03-01');
  });
});
