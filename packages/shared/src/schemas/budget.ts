import { z } from 'zod';
import {
  amountMinorSchema,
  civilDateSchema,
  currencySchema,
  optionalCivilDate,
} from './common.js';
import { expenseCategorySchema, monthSchema } from './expense.js';

export const createBudgetSchema = z.object({
  /** Omit for the household's overall monthly limit. */
  category: expenseCategorySchema.nullable().optional(),
  amountMinor: amountMinorSchema.refine((v) => v > 0, 'A budget of nothing is not a budget'),
  currency: currencySchema.optional(),
  startsOn: civilDateSchema.optional(),
  /** Warn on approach, before the limit is actually crossed. */
  warnAtPercent: z.coerce.number().int().min(1).max(100).default(80),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  amountMinor: amountMinorSchema.optional(),
  warnAtPercent: z.coerce.number().int().min(1).max(100).optional(),
  endsOn: optionalCivilDate(),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const budgetStatusQuerySchema = z.object({
  month: monthSchema.optional(),
});
export type BudgetStatusQuery = z.infer<typeof budgetStatusQuerySchema>;

/** How a budget is doing: under, approaching its warning point, or over. */
export const BUDGET_STATES = ['under', 'approaching', 'over'] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];
