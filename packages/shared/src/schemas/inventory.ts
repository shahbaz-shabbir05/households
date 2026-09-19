import { z } from 'zod';
import { INVENTORY_CATEGORIES, INVENTORY_KINDS, UNITS } from '../enums.js';
import {
  amountMinorSchema,
  optionalCivilDate,
  optionalText,
  paginationSchema,
  requiredText,
  sortOrderSchema,
  uuidSchema,
} from './common.js';

export const inventoryKindSchema = z.enum(INVENTORY_KINDS);
export const inventoryCategorySchema = z.enum(INVENTORY_CATEGORIES);
export const unitSchema = z.enum(UNITS);

/** Quantities may be fractional (1.5 kg), but never negative. */
const quantitySchema = z.coerce.number().nonnegative().max(1_000_000_000);

export const createInventoryItemSchema = z.object({
  name: requiredText(120, 'Item name'),
  kind: inventoryKindSchema.default('grocery'),
  category: inventoryCategorySchema.default('other'),
  unit: unitSchema.default('piece'),
  quantity: quantitySchema.default(0),
  /** Below this the item is "running low". Omit to never warn about it. */
  minQuantity: quantitySchema.nullable().optional(),
  location: optionalText(80),
  expiryDate: optionalCivilDate(),
  brand: optionalText(80),
  preferredBrand: optionalText(80),
  estimatedPriceMinor: amountMinorSchema.nullable().optional(),
  /** "We buy rice about every 30 days" — drives a restock suggestion. */
  restockIntervalDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  notes: optionalText(1000),
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const updateInventoryItemSchema = createInventoryItemSchema.partial();
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

/**
 * Adjusting stock is its own operation rather than a quantity PATCH: "we used
 * two" and "we now have two" are different statements, and conflating them is
 * how inventory silently drifts.
 */
export const adjustInventorySchema = z
  .object({
    delta: z.coerce.number().optional(),
    setTo: quantitySchema.optional(),
    reason: optionalText(200),
  })
  .refine((v) => (v.delta === undefined) !== (v.setTo === undefined), {
    message: 'Provide either a delta or an absolute quantity, not both',
    path: ['delta'],
  });
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

export const INVENTORY_SORT_FIELDS = ['name', 'category', 'quantity', 'expiryDate'] as const;

export const listInventoryQuerySchema = paginationSchema.extend({
  kind: inventoryKindSchema.optional(),
  category: inventoryCategorySchema.optional(),
  /** Only items at or below their threshold. */
  lowStock: z.coerce.boolean().optional(),
  /** Only items expiring within N days. */
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  search: optionalText(200),
  sort: z.enum(INVENTORY_SORT_FIELDS).default('name'),
  order: sortOrderSchema.default('asc'),
});
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

export { uuidSchema };
