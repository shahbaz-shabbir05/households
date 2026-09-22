import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../enums.js';
import {
  amountMinorSchema,
  civilDateSchema,
  currencySchema,
  optionalCivilDate,
  optionalText,
  paginationSchema,
  sortOrderSchema,
  uuidSchema,
} from './common.js';

export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const createExpenseSchema = z.object({
  /** Integer minor units, always. The client parses user input before sending. */
  amountMinor: amountMinorSchema,
  /** Defaults to the household currency server-side when omitted. */
  currency: currencySchema.optional(),
  spentOn: civilDateSchema,
  category: expenseCategorySchema.default('other'),
  subcategory: optionalText(80),
  paidByMemberId: uuidSchema.nullable().optional(),
  forMemberId: uuidSchema.nullable().optional(),
  paymentMethod: paymentMethodSchema.default('cash'),
  merchant: optionalText(120),
  description: optionalText(1000),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const EXPENSE_SORT_FIELDS = ['spentOn', 'amountMinor', 'createdAt'] as const;

export const listExpensesQuerySchema = paginationSchema.extend({
  from: optionalCivilDate(),
  to: optionalCivilDate(),
  category: expenseCategorySchema.optional(),
  paidByMemberId: uuidSchema.optional(),
  forMemberId: uuidSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  search: optionalText(200),
  sort: z.enum(EXPENSE_SORT_FIELDS).default('spentOn'),
  order: sortOrderSchema.default('desc'),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

/** `YYYY-MM`, the period a monthly summary covers. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month in YYYY-MM format');

export const expenseSummaryQuerySchema = z.object({
  month: monthSchema.optional(),
});
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;
