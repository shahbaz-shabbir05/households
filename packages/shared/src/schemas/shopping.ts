import { z } from 'zod';
import { PRIORITIES, SHOPPING_LIST_STATUSES } from '../enums.js';
import {
  amountMinorSchema,
  civilDateSchema,
  optionalText,
  paginationSchema,
  requiredText,
  uuidSchema,
} from './common.js';
import { inventoryCategorySchema, unitSchema } from './inventory.js';
import { paymentMethodSchema, expenseCategorySchema } from './expense.js';

export const shoppingListStatusSchema = z.enum(SHOPPING_LIST_STATUSES);

export const createShoppingListSchema = z.object({
  name: requiredText(120, 'List name'),
  store: optionalText(120),
  shopperMemberId: uuidSchema.nullable().optional(),
});
export type CreateShoppingListInput = z.infer<typeof createShoppingListSchema>;

export const updateShoppingListSchema = createShoppingListSchema.partial();
export type UpdateShoppingListInput = z.infer<typeof updateShoppingListSchema>;

export const listShoppingListsQuerySchema = paginationSchema.extend({
  status: shoppingListStatusSchema.optional(),
});
export type ListShoppingListsQuery = z.infer<typeof listShoppingListsQuerySchema>;

/**
 * Either link an existing inventory item or name an ad-hoc one. Linking is what
 * makes the trip restock inventory automatically; an ad-hoc item is just a
 * line on the list.
 */
export const addShoppingItemSchema = z
  .object({
    inventoryItemId: uuidSchema.optional(),
    name: optionalText(120),
    category: inventoryCategorySchema.optional(),
    quantity: z.coerce.number().positive().max(100_000).default(1),
    unit: unitSchema.optional(),
    priority: z.enum(PRIORITIES).default('normal'),
    notes: optionalText(500),
  })
  .refine((v) => Boolean(v.inventoryItemId ?? v.name), {
    message: 'Give the item a name, or pick one from your inventory',
    path: ['name'],
  });
export type AddShoppingItemInput = z.infer<typeof addShoppingItemSchema>;

export const updateShoppingItemSchema = z.object({
  quantity: z.coerce.number().positive().max(100_000).optional(),
  unit: unitSchema.optional(),
  priority: z.enum(PRIORITIES).optional(),
  isPurchased: z.boolean().optional(),
  actualPriceMinor: amountMinorSchema.nullable().optional(),
  notes: optionalText(500),
});
export type UpdateShoppingItemInput = z.infer<typeof updateShoppingItemSchema>;

/**
 * Completing a trip is the workflow that makes these modules a system rather
 * than separate screens: in one transaction it marks what was bought, restocks
 * inventory, records the spend, and closes the list (docs/06, docs/46).
 */
export const completeTripSchema = z.object({
  /** Items actually bought. Omit to treat every unticked item as purchased. */
  purchasedItemIds: z.array(uuidSchema).max(500).optional(),
  /** Per-item prices, where the shopper bothered to enter them. */
  itemPrices: z
    .array(z.object({ itemId: uuidSchema, actualPriceMinor: amountMinorSchema }))
    .max(500)
    .optional(),

  /** What was actually paid at the till. */
  amountMinor: amountMinorSchema.optional(),
  /** False when someone else paid, or the household is not tracking this spend. */
  recordExpense: z.boolean().default(true),
  expenseCategory: expenseCategorySchema.default('groceries'),
  paymentMethod: paymentMethodSchema.default('cash'),
  paidByMemberId: uuidSchema.nullable().optional(),
  merchant: optionalText(120),
  shoppedOn: civilDateSchema.optional(),

  /** False to close the list without touching stock levels. */
  restockInventory: z.boolean().default(true),
})
  .refine((v) => !v.recordExpense || v.amountMinor !== undefined, {
    message: 'Enter what you spent, or turn off recording an expense',
    path: ['amountMinor'],
  });
export type CompleteTripInput = z.infer<typeof completeTripSchema>;

/** Pulls everything currently running low onto a list in one action. */
export const addLowStockSchema = z.object({
  /** Also include items due a restock by their usual cadence. */
  includeRestockDue: z.boolean().default(true),
});
export type AddLowStockInput = z.infer<typeof addLowStockSchema>;
