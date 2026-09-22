import { z } from 'zod';
import { BILL_STATUSES, BILL_TYPES, UTILITY_KINDS } from '../enums.js';
import {
  amountMinorSchema,
  booleanish,
  civilDateSchema,
  currencySchema,
  optionalCivilDate,
  optionalText,
  paginationSchema,
  recurrenceRuleSchema,
  requiredText,
  sortOrderSchema,
  uuidSchema,
} from './common.js';
import { expenseCategorySchema, paymentMethodSchema } from './expense.js';

export const billTypeSchema = z.enum(BILL_TYPES);
export const billStatusSchema = z.enum(BILL_STATUSES);
export const utilityKindSchema = z.enum(UTILITY_KINDS);

export const createBillSchema = z
  .object({
    name: requiredText(120, 'Bill name'),
    billType: billTypeSchema.default('utility'),
    /** Matched to an existing provider by name, or created on first use. */
    providerName: optionalText(120),
    utilityKind: utilityKindSchema.optional(),
    accountNumber: optionalText(80),

    dueDate: civilDateSchema,
    issueDate: optionalCivilDate(),
    periodStart: optionalCivilDate(),
    periodEnd: optionalCivilDate(),

    amountMinor: amountMinorSchema,
    currency: currencySchema.optional(),
    /** Which expense category a payment lands in. */
    expenseCategory: expenseCategorySchema.default('utilities'),
    ownerMemberId: uuidSchema.nullable().optional(),

    remindDaysBefore: z.coerce.number().int().min(0).max(90).default(3),
    notes: optionalText(1000),
    recurrence: recurrenceRuleSchema.optional(),
  })
  .refine((b) => !b.periodEnd || !b.periodStart || b.periodEnd >= b.periodStart, {
    message: 'The billing period cannot end before it starts',
    path: ['periodEnd'],
  });
export type CreateBillInput = z.infer<typeof createBillSchema>;

export const updateBillSchema = z.object({
  name: requiredText(120, 'Bill name').optional(),
  billType: billTypeSchema.optional(),
  providerName: optionalText(120),
  accountNumber: optionalText(80),
  dueDate: civilDateSchema.optional(),
  issueDate: optionalCivilDate(),
  periodStart: optionalCivilDate(),
  periodEnd: optionalCivilDate(),
  amountMinor: amountMinorSchema.optional(),
  expenseCategory: expenseCategorySchema.optional(),
  ownerMemberId: uuidSchema.nullable().optional(),
  remindDaysBefore: z.coerce.number().int().min(0).max(90).optional(),
  notes: optionalText(1000),
});
export type UpdateBillInput = z.infer<typeof updateBillSchema>;

/**
 * Paying a bill records the payment *and* writes the expense, in one
 * transaction — the same composition as completing a shopping trip (§46).
 */
export const payBillSchema = z.object({
  /** Defaults to the full amount owed. */
  amountMinor: amountMinorSchema.optional(),
  paidOn: optionalCivilDate(),
  paymentMethod: paymentMethodSchema.default('cash'),
  paidByMemberId: uuidSchema.nullable().optional(),
  /** False when the payment is already in the ledger some other way. */
  recordExpense: booleanish.default(true),
  notes: optionalText(500),
});
export type PayBillInput = z.infer<typeof payBillSchema>;

export const BILL_SORT_FIELDS = ['dueDate', 'amountMinor', 'name'] as const;

export const listBillsQuerySchema = paginationSchema.extend({
  status: billStatusSchema.optional(),
  billType: billTypeSchema.optional(),
  /** Everything not yet paid or cancelled — the common view. */
  unpaid: booleanish.optional(),
  from: optionalCivilDate(),
  to: optionalCivilDate(),
  ownerMemberId: uuidSchema.optional(),
  search: optionalText(200),
  sort: z.enum(BILL_SORT_FIELDS).default('dueDate'),
  order: sortOrderSchema.default('asc'),
});
export type ListBillsQuery = z.infer<typeof listBillsQuerySchema>;
