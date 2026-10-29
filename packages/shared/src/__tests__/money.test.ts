import { describe, expect, it } from 'vitest';
import {
  addMoney,
  formatMoney,
  minorUnitDigits,
  money,
  parseMoneyInput,
  percentOf,
  sumMoney,
  toMajorUnits,
} from '../money.js';

describe('money', () => {
  it('refuses a non-integer amount, because floats and money do not mix', () => {
    expect(() => money(12.5, 'PKR')).toThrow(TypeError);
  });

  it('normalises the currency code', () => {
    expect(money(100, 'pkr').currency).toBe('PKR');
  });

  it('knows currencies with non-standard minor units', () => {
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(minorUnitDigits('KWD')).toBe(3);
    expect(minorUnitDigits('PKR')).toBe(2);
  });

  it('refuses to add different currencies rather than guessing a rate', () => {
    expect(() => addMoney(money(100, 'PKR'), money(100, 'USD'))).toThrow(TypeError);
  });

  it('sums a list', () => {
    const total = sumMoney([money(1000, 'PKR'), money(2500, 'PKR')], 'PKR');
    expect(total.amountMinor).toBe(3500);
  });

  it('sums an empty list to zero of the given currency', () => {
    expect(sumMoney([], 'PKR')).toEqual({ amountMinor: 0, currency: 'PKR' });
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['1250', 'PKR', 125000],
    ['1,250', 'PKR', 125000],
    ['1250.50', 'PKR', 125050],
    ['1 250', 'PKR', 125000],
    ['0', 'PKR', 0],
    ['1250', 'JPY', 1250],
  ])('parses %s (%s) into %i minor units', (input, currency, expected) => {
    expect(parseMoneyInput(input, currency)).toBe(expected);
  });

  it('returns null for unparseable input instead of zero', () => {
    // Returning 0 would silently record a free purchase.
    expect(parseMoneyInput('', 'PKR')).toBeNull();
    expect(parseMoneyInput('abc', 'PKR')).toBeNull();
    expect(parseMoneyInput('.', 'PKR')).toBeNull();
  });

  it('rounds rather than truncating', () => {
    expect(parseMoneyInput('10.005', 'PKR')).toBe(1001);
  });
});

describe('formatMoney', () => {
  it('formats PKR without decimals, matching local convention', () => {
    expect(formatMoney(5_000_00, 'PKR', 'en-PK')).toMatch(/5,000/);
    expect(formatMoney(5_000_00, 'PKR', 'en-PK')).not.toMatch(/\.00/);
  });

  it('formats USD with decimals', () => {
    expect(formatMoney(1234, 'USD', 'en-US')).toBe('$12.34');
  });
});

describe('toMajorUnits / percentOf', () => {
  it('converts minor to major units', () => {
    expect(toMajorUnits(125050, 'PKR')).toBe(1250.5);
    expect(toMajorUnits(1250, 'JPY')).toBe(1250);
  });

  it('returns null rather than a misleading 0% when no base is set', () => {
    expect(percentOf(5000, 0)).toBeNull();
    expect(percentOf(5000, 10000)).toBe(50);
  });
});
