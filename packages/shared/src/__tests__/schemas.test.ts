import { describe, expect, it } from 'vitest';
import { createEventSchema, createMemberSchema, createTaskSchema } from '../schemas/index.js';

/**
 * An untouched `<input type="date">` submits an empty string. The contract has
 * to accept what browsers actually send, or every optional date on every create
 * form fails the first time someone leaves it blank.
 */
describe('optional dates as a form submits them', () => {
  it('treats an empty date of birth as not provided', () => {
    const parsed = createMemberSchema.safeParse({ displayName: 'Nani', dateOfBirth: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.dateOfBirth).toBeUndefined();
  });

  it('still rejects a malformed date', () => {
    expect(createMemberSchema.safeParse({ displayName: 'Nani', dateOfBirth: '32/01/2020' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ displayName: 'Nani', dateOfBirth: '2026-02-30' }).success).toBe(false);
  });

  it('treats empty task dates and times as cleared', () => {
    const parsed = createTaskSchema.safeParse({ title: 'Something', dueDate: '', dueTime: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.dueDate).toBeNull();
  });

  it('treats an empty event time as an all-day event', () => {
    const parsed = createEventSchema.safeParse({
      title: 'Birthday',
      startDate: '2026-04-18',
      startTime: '',
      endDate: '',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.startTime).toBeNull();
  });

  it('accepts a real value unchanged', () => {
    const parsed = createMemberSchema.safeParse({ displayName: 'Zara', dateOfBirth: '2011-04-18' });
    expect(parsed.success && parsed.data.dateOfBirth).toBe('2011-04-18');
  });
});

import { booleanish, listMembersQuerySchema, updateEventSchema } from '../schemas/index.js';

/**
 * Regression: `z.coerce.boolean()` is `Boolean(value)`, so the string "false"
 * — exactly what a query string or an env file contains — parsed as true and
 * silently inverted every flag it touched.
 */
describe('booleans as they arrive over the wire', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
    ['on', true],
    ['off', false],
    ['FALSE', false],
    ['  false  ', false],
  ])('parses %j as %s', (input, expected) => {
    expect(booleanish.parse(input)).toBe(expected);
  });

  it('passes real booleans through', () => {
    expect(booleanish.parse(true)).toBe(true);
    expect(booleanish.parse(false)).toBe(false);
  });

  it('rejects anything it cannot read, rather than guessing', () => {
    expect(booleanish.safeParse('maybe').success).toBe(false);
    expect(booleanish.safeParse('').success).toBe(false);
    expect(booleanish.safeParse(2).success).toBe(false);
  });

  it('does not invert a query filter', () => {
    // The web client sends `?includeInactive=false` literally.
    const parsed = listMembersQuerySchema.parse({ includeInactive: 'false' });
    expect(parsed.includeInactive).toBe(false);
  });
});

/**
 * Regression: `updateEventSchema` spread a field carrying `.default('other')`,
 * so renaming a birthday converted it into an "other" event.
 */
describe('updating an event', () => {
  it('leaves the type alone when it is not being changed', () => {
    const parsed = updateEventSchema.parse({ title: "Zara's birthday 2027" });
    expect(parsed.eventType).toBeUndefined();
    expect(parsed).toEqual({ title: "Zara's birthday 2027", participantMemberIds: undefined });
  });

  it('still accepts an explicit type change', () => {
    expect(updateEventSchema.parse({ eventType: 'wedding' }).eventType).toBe('wedding');
  });
});
