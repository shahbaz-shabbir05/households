import { describe, expect, it } from 'vitest';
import {
  InvalidRecurrenceRuleError,
  describeRecurrence,
  expandOccurrences,
  nextOccurrence,
  validateRecurrenceRule,
  type RecurrenceRule,
} from '../recurrence.js';

const rule = (over: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'freq'>): RecurrenceRule => ({
  interval: 1,
  ...over,
});

describe('expandOccurrences — daily', () => {
  it('repeats every day from the anchor', () => {
    expect(expandOccurrences(rule({ freq: 'daily' }), '2026-01-01', { limit: 4 })).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('honours an interval (milk every 2 days)', () => {
    expect(expandOccurrences(rule({ freq: 'daily', interval: 2 }), '2026-01-01', { limit: 3 })).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(expandOccurrences(rule({ freq: 'daily' }), '2026-01-30', { limit: 3 })).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
    ]);
  });
});

describe('expandOccurrences — weekly', () => {
  it('defaults to the anchor weekday', () => {
    // 2026-01-05 is a Monday.
    expect(expandOccurrences(rule({ freq: 'weekly' }), '2026-01-05', { limit: 3 })).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
    ]);
  });

  it('supports several weekdays in one week', () => {
    // Monday(1) and Friday(5), anchored on a Monday.
    expect(
      expandOccurrences(rule({ freq: 'weekly', byWeekday: [1, 5] }), '2026-01-05', { limit: 4 }),
    ).toEqual(['2026-01-05', '2026-01-09', '2026-01-12', '2026-01-16']);
  });

  it('skips weekdays that fall before the anchor in the anchor week', () => {
    // Anchored Wednesday 2026-01-07, wanting Mon+Fri: Monday 05 is before the anchor.
    expect(
      expandOccurrences(rule({ freq: 'weekly', byWeekday: [1, 5] }), '2026-01-07', { limit: 3 }),
    ).toEqual(['2026-01-09', '2026-01-12', '2026-01-16']);
  });

  it('counts intervals from the anchor week, not an arbitrary epoch', () => {
    expect(
      expandOccurrences(rule({ freq: 'weekly', interval: 2 }), '2026-01-05', { limit: 3 }),
    ).toEqual(['2026-01-05', '2026-01-19', '2026-02-02']);
  });

  it('handles Sunday (weekday 0) in a Monday-based week', () => {
    // 2026-01-04 is a Sunday.
    expect(expandOccurrences(rule({ freq: 'weekly' }), '2026-01-04', { limit: 2 })).toEqual([
      '2026-01-04',
      '2026-01-11',
    ]);
  });
});

describe('expandOccurrences — monthly', () => {
  it('repeats on the anchor day of month', () => {
    expect(expandOccurrences(rule({ freq: 'monthly' }), '2026-01-15', { limit: 3 })).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('clamps the 31st to the end of short months rather than skipping them', () => {
    // A rent bill due on the 31st must still exist in February.
    expect(expandOccurrences(rule({ freq: 'monthly' }), '2026-01-31', { limit: 4 })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('does not let February clamping stick for later months', () => {
    const dates = expandOccurrences(rule({ freq: 'monthly', byMonthday: [30] }), '2026-01-30', {
      limit: 3,
    });
    expect(dates).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
  });

  it('supports -1 as the last day of the month', () => {
    expect(
      expandOccurrences(rule({ freq: 'monthly', byMonthday: [-1] }), '2026-01-01', { limit: 3 }),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('supports several monthdays, in ascending order', () => {
    expect(
      expandOccurrences(rule({ freq: 'monthly', byMonthday: [1, 15] }), '2026-01-01', { limit: 4 }),
    ).toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15']);
  });

  it('honours an interval (quarterly)', () => {
    expect(
      expandOccurrences(rule({ freq: 'monthly', interval: 3 }), '2026-01-10', { limit: 3 }),
    ).toEqual(['2026-01-10', '2026-04-10', '2026-07-10']);
  });
});

describe('expandOccurrences — yearly', () => {
  it('repeats on the anchor month and day', () => {
    expect(expandOccurrences(rule({ freq: 'yearly' }), '2026-03-14', { limit: 3 })).toEqual([
      '2026-03-14',
      '2027-03-14',
      '2028-03-14',
    ]);
  });

  it('clamps 29 February to the 28th in non-leap years', () => {
    expect(expandOccurrences(rule({ freq: 'yearly' }), '2024-02-29', { limit: 3 })).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
    ]);
  });

  it('supports byMonth for multi-month yearly rules', () => {
    expect(
      expandOccurrences(rule({ freq: 'yearly', byMonth: [3, 9], byMonthday: [1] }), '2026-01-01', {
        limit: 4,
      }),
    ).toEqual(['2026-03-01', '2026-09-01', '2027-03-01', '2027-09-01']);
  });
});

describe('bounds', () => {
  it('stops at `until`, inclusively', () => {
    expect(
      expandOccurrences(rule({ freq: 'daily', until: '2026-01-03' }), '2026-01-01'),
    ).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('stops after `count` occurrences', () => {
    expect(expandOccurrences(rule({ freq: 'weekly', count: 2 }), '2026-01-05')).toEqual([
      '2026-01-05',
      '2026-01-12',
    ]);
  });

  it('counts `count` from the series start, not from the window start', () => {
    // 3 occurrences exist in total; asking for a later window must not reveal a 4th.
    const dates = expandOccurrences(rule({ freq: 'daily', count: 3 }), '2026-01-01', {
      from: '2026-01-02',
    });
    expect(dates).toEqual(['2026-01-02', '2026-01-03']);
  });

  it('filters to a window without changing which occurrences exist', () => {
    const dates = expandOccurrences(rule({ freq: 'monthly' }), '2026-01-15', {
      from: '2026-03-01',
      to: '2026-05-31',
    });
    expect(dates).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
  });

  it('returns nothing when the window precedes the anchor', () => {
    expect(
      expandOccurrences(rule({ freq: 'daily' }), '2026-06-01', { to: '2026-05-01' }),
    ).toEqual([]);
  });

  it('terminates for a never-ending rule via the limit', () => {
    expect(expandOccurrences(rule({ freq: 'daily' }), '2026-01-01', { limit: 500 })).toHaveLength(500);
  });
});

describe('validation', () => {
  it('rejects `until` together with `count`', () => {
    expect(() => validateRecurrenceRule(rule({ freq: 'daily', until: '2026-01-01', count: 3 }))).toThrow(
      InvalidRecurrenceRuleError,
    );
  });

  it('rejects an interval below 1', () => {
    expect(() => validateRecurrenceRule(rule({ freq: 'daily', interval: 0 }))).toThrow(
      InvalidRecurrenceRuleError,
    );
  });

  it('rejects out-of-range weekdays and monthdays', () => {
    expect(() => validateRecurrenceRule(rule({ freq: 'weekly', byWeekday: [7] }))).toThrow();
    expect(() => validateRecurrenceRule(rule({ freq: 'monthly', byMonthday: [0] }))).toThrow();
    expect(() => validateRecurrenceRule(rule({ freq: 'monthly', byMonthday: [32] }))).toThrow();
  });

  it('rejects selectors on the wrong frequency', () => {
    expect(() => validateRecurrenceRule(rule({ freq: 'monthly', byWeekday: [1] }))).toThrow();
    expect(() => validateRecurrenceRule(rule({ freq: 'daily', byMonthday: [1] }))).toThrow();
    expect(() => validateRecurrenceRule(rule({ freq: 'monthly', byMonth: [1] }))).toThrow();
  });
});

describe('nextOccurrence', () => {
  it('returns the first occurrence strictly after the given date', () => {
    expect(nextOccurrence(rule({ freq: 'monthly' }), '2026-01-15', '2026-01-15')).toBe('2026-02-15');
  });

  it('returns null once the series has ended', () => {
    expect(nextOccurrence(rule({ freq: 'daily', count: 2 }), '2026-01-01', '2026-01-02')).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it.each([
    [rule({ freq: 'daily' }), 'Every day'],
    [rule({ freq: 'daily', interval: 2 }), 'Every 2 days'],
    [rule({ freq: 'weekly', byWeekday: [1, 5] }), 'Every week on Monday and Friday'],
    [rule({ freq: 'monthly', byMonthday: [-1] }), 'Every month on the last day'],
    [rule({ freq: 'monthly', byMonthday: [1] }), 'Every month on the 1st'],
    [rule({ freq: 'monthly', interval: 3 }), 'Every 3 months'],
    [rule({ freq: 'yearly' }), 'Every year'],
  ])('describes %j as "%s"', (r, expected) => {
    expect(describeRecurrence(r)).toBe(expected);
  });

  it('mentions the bound', () => {
    expect(describeRecurrence(rule({ freq: 'daily', until: '2026-03-01' }))).toBe(
      'Every day until 2026-03-01',
    );
    expect(describeRecurrence(rule({ freq: 'daily', count: 5 }))).toBe('Every day, 5 times');
  });
});
