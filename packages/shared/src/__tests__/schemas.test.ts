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
