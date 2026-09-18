/**
 * Money is always an integer count of minor units plus an ISO-4217 code.
 * Floats are never used for money anywhere in this codebase (docs/04).
 *
 * PKR is quoted without paisa in everyday use, but we still store x100
 * uniformly so a single representation covers every currency. Display
 * precision is a formatting concern, not a storage one.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

/** Currencies whose minor unit is not 1/100. */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
};

/** Currencies conventionally displayed without decimals even though stored x100. */
const DISPLAY_WHOLE_UNITS = new Set(['PKR', 'INR', 'LKR', 'BDT', 'NPR', 'IDR']);

export function minorUnitDigits(currency: string): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(`amountMinor must be an integer, received ${amountMinor}`);
  }
  return { amountMinor, currency: currency.toUpperCase() };
}

/** Parses user input ("1,250.50", "1250") into minor units. Returns null if unparseable. */
export function parseMoneyInput(input: string, currency: string): number | null {
  const cleaned = input.replace(/[\s,_]/g, '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** minorUnitDigits(currency);
  return Math.round(value * factor);
}

export function toMajorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** minorUnitDigits(currency);
}

/**
 * Formats for display. Uses `Intl` so locale conventions (Pakistani digit
 * grouping, for instance) come from the platform rather than being hard-coded.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = 'en-PK',
  options: { compact?: boolean } = {},
): string {
  const code = currency.toUpperCase();
  const digits = DISPLAY_WHOLE_UNITS.has(code) ? 0 : minorUnitDigits(code);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    notation: options.compact ? 'compact' : 'standard',
  }).format(toMajorUnits(amountMinor, code));
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(values: Money[], currency: string): Money {
  return values.reduce((acc, v) => {
    assertSameCurrency(acc, v);
    return money(acc.amountMinor + v.amountMinor, currency);
  }, money(0, currency));
}

/**
 * Percentage as a number 0..n, or null when the base is zero. Returning null
 * rather than 0 or Infinity forces callers to decide what "no budget set" means
 * instead of rendering a misleading 0%.
 */
export function percentOf(amountMinor: number, baseMinor: number): number | null {
  if (baseMinor === 0) return null;
  return (amountMinor / baseMinor) * 100;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    // We never convert silently: an FX rate needs a date and a source, and a
    // wrong total is worse than a refused one (docs/04).
    throw new TypeError(`Cannot combine ${a.currency} with ${b.currency} without an explicit rate`);
  }
}
