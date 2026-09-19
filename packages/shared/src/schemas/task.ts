import { z } from 'zod';
import { PRIORITIES, TASK_CATEGORIES, TASK_STATUSES } from '../enums.js';
import {
  civilDateSchema,
  nullableCivilDate,
  nullableTimeOfDay,
  optionalText,
  paginationSchema,
  recurrenceRuleSchema,
  requiredText,
  sortOrderSchema,
  uuidSchema,
} from './common.js';

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(PRIORITIES);
export const taskCategorySchema = z.enum(TASK_CATEGORIES);

export const createTaskSchema = z
  .object({
    title: requiredText(200, 'Task title'),
    description: optionalText(4000),
    priority: taskPrioritySchema.default('normal'),
    category: taskCategorySchema.default('other'),
    assigneeMemberId: uuidSchema.nullable().optional(),
    dueDate: nullableCivilDate(),
    dueTime: nullableTimeOfDay(),
    startDate: nullableCivilDate(),
    estimatedMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
    notes: optionalText(2000),
    /** Present means "make this a repeating task"; the series generates instances. */
    recurrence: recurrenceRuleSchema.optional(),
  })
  .refine((t) => !t.recurrence || t.dueDate, {
    message: 'A repeating task needs a first due date to repeat from',
    path: ['dueDate'],
  })
  .refine((t) => !t.dueTime || t.dueDate, {
    message: 'A due time needs a due date',
    path: ['dueTime'],
  });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: requiredText(200, 'Task title').optional(),
  description: optionalText(4000),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  category: taskCategorySchema.optional(),
  assigneeMemberId: uuidSchema.nullable().optional(),
  dueDate: nullableCivilDate(),
  dueTime: nullableTimeOfDay(),
  startDate: nullableCivilDate(),
  estimatedMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
  notes: optionalText(2000),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const TASK_SORT_FIELDS = ['dueDate', 'priority', 'createdAt', 'title'] as const;

export const listTasksQuerySchema = paginationSchema.extend({
  status: taskStatusSchema.optional(),
  /** Convenience filter: everything not finished or cancelled. */
  open: z.coerce.boolean().optional(),
  category: taskCategorySchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeMemberId: uuidSchema.optional(),
  /** `me` resolves to the caller's own member id, so the client needs no lookup. */
  assignee: z.literal('me').optional(),
  dueBefore: civilDateSchema.optional(),
  dueAfter: civilDateSchema.optional(),
  overdue: z.coerce.boolean().optional(),
  search: optionalText(200),
  sort: z.enum(TASK_SORT_FIELDS).default('dueDate'),
  order: sortOrderSchema,
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** How an edit or deletion applies to a repeating task (docs/08). */
export const seriesScopeSchema = z.enum(['occurrence', 'following']).default('occurrence');

export const completeTaskSchema = z.object({
  completed: z.boolean().default(true),
});
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
