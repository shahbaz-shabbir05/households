import { describe, expect, it } from 'vitest';
import {
  civilDateIn,
  instantFrom,
  isWithinQuietHours,
  nextQuietHoursEnd,
  timeOfDayIn,
  todayIn,
  upcomingWindow,
  weekWindow,
} from './time.js';

/**
 * Every "due today" bug in a product like this comes from doing date maths in
 * the server's timezone. These tests pin the household-timezone behaviour.
 */
describe('civil dates in a household timezone', () => {
  it('reports a different day either side of midnight local time', () => {
    const instant = new Date('2026-03-01T19:30:00Z');
    // 00:30 the next day in Karachi (UTC+5), still the 1st in London.
    expect(civilDateIn(instant, 'Asia/Karachi')).toBe('2026-03-02');
    expect(civilDateIn(instant, 'Europe/London')).toBe('2026-03-01');
    expect(civilDateIn(instant, 'America/Los_Angeles')).toBe('2026-03-01');
  });

  it('handles the far side of the date line', () => {
    expect(civilDateIn(new Date('2026-03-01T12:00:00Z'), 'Pacific/Kiritimati')).toBe('2026-03-02');
    expect(civilDateIn(new Date('2026-03-01T12:00:00Z'), 'Pacific/Midway')).toBe('2026-03-01');
  });

  it('reports the local wall-clock time', () => {
    expect(timeOfDayIn(new Date('2026-03-01T19:30:00Z'), 'Asia/Karachi')).toBe('00:30');
    expect(timeOfDayIn(new Date('2026-03-01T19:30:00Z'), 'UTC')).toBe('19:30');
  });

  it('uses the household timezone for "today"', () => {
    const now = new Date('2026-06-30T20:00:00Z');
    expect(todayIn('Asia/Karachi', now)).toBe('2026-07-01');
    expect(todayIn('UTC', now)).toBe('2026-06-30');
  });
});

describe('instantFrom', () => {
  it('converts a local wall-clock time to the right UTC instant', () => {
    expect(instantFrom('2026-03-01', '08:00', 'Asia/Karachi').toISOString()).toBe(
      '2026-03-01T03:00:00.000Z',
    );
    expect(instantFrom('2026-03-01', '08:00', 'UTC').toISOString()).toBe('2026-03-01T08:00:00.000Z');
  });

  it('keeps a local time stable across a DST transition', () => {
    // London moves to BST on 2026-03-29. "08:00 local" must stay 08:00 local.
    const before = instantFrom('2026-03-28', '08:00', 'Europe/London');
    const after = instantFrom('2026-03-30', '08:00', 'Europe/London');

    expect(timeOfDayIn(before, 'Europe/London')).toBe('08:00');
    expect(timeOfDayIn(after, 'Europe/London')).toBe('08:00');
    // ...even though the UTC offsets differ.
    expect(before.toISOString()).toBe('2026-03-28T08:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-30T07:00:00.000Z');
  });

  it('round-trips through the civil date it came from', () => {
    const instant = instantFrom('2026-11-01', '23:45', 'America/Los_Angeles');
    expect(civilDateIn(instant, 'America/Los_Angeles')).toBe('2026-11-01');
    expect(timeOfDayIn(instant, 'America/Los_Angeles')).toBe('23:45');
  });
});

describe('windows', () => {
  it('computes the current week from the household week start', () => {
    const now = new Date('2026-03-11T09:00:00Z'); // a Wednesday
    expect(weekWindow('UTC', 1, now)).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(weekWindow('UTC', 0, now)).toEqual({ from: '2026-03-08', to: '2026-03-14' });
  });

  it('computes a rolling upcoming window', () => {
    const now = new Date('2026-03-11T09:00:00Z');
    expect(upcomingWindow('UTC', 7, now)).toEqual({ from: '2026-03-11', to: '2026-03-18' });
  });
});

describe('quiet hours', () => {
  const tz = 'Asia/Karachi';

  it('recognises a window that wraps midnight', () => {
    // 23:00 local = 18:00Z
    expect(isWithinQuietHours(new Date('2026-03-01T18:00:00Z'), tz, '22:00', '07:00')).toBe(true);
    // 03:00 local = 22:00Z the previous day
    expect(isWithinQuietHours(new Date('2026-02-28T22:00:00Z'), tz, '22:00', '07:00')).toBe(true);
    // 12:00 local = 07:00Z
    expect(isWithinQuietHours(new Date('2026-03-01T07:00:00Z'), tz, '22:00', '07:00')).toBe(false);
  });

  it('recognises a same-day window', () => {
    // 14:00 local
    expect(isWithinQuietHours(new Date('2026-03-01T09:00:00Z'), tz, '13:00', '16:00')).toBe(true);
    expect(isWithinQuietHours(new Date('2026-03-01T14:00:00Z'), tz, '13:00', '16:00')).toBe(false);
  });

  it('treats unset quiet hours as always awake', () => {
    expect(isWithinQuietHours(new Date(), tz, null, null)).toBe(false);
    expect(isWithinQuietHours(new Date(), tz, '22:00', null)).toBe(false);
  });

  it('defers to the next time the window ends', () => {
    // 01:00 local on 2 March → quiet hours end at 07:00 the same local day.
    const at = new Date('2026-03-01T20:00:00Z');
    const next = nextQuietHoursEnd(at, tz, '07:00');
    expect(civilDateIn(next, tz)).toBe('2026-03-02');
    expect(timeOfDayIn(next, tz)).toBe('07:00');
    expect(next.getTime()).toBeGreaterThan(at.getTime());
  });

  it('rolls to tomorrow when the window has already ended today', () => {
    // 12:00 local, quiet hours ended at 07:00 → next release is tomorrow 07:00.
    const at = new Date('2026-03-01T07:00:00Z');
    const next = nextQuietHoursEnd(at, tz, '07:00');
    expect(civilDateIn(next, tz)).toBe('2026-03-02');
  });
});
