/**
 * Closed value sets shared by the API, the database CHECK constraints and the
 * UI. Declared once here so the three can never disagree.
 */

export const HOUSEHOLD_ROLES = ['admin', 'adult', 'teen', 'child', 'helper'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/** Ordered most- to least-privileged; used for "at least this role" comparisons. */
export const ROLE_RANK: Record<HouseholdRole, number> = {
  admin: 4,
  adult: 3,
  teen: 2,
  child: 1,
  helper: 0,
};

export const RELATIONSHIPS = [
  'self', 'spouse', 'parent', 'child', 'sibling',
  'grandparent', 'grandchild', 'relative', 'helper', 'other',
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_CATEGORIES = [
  'chore', 'cleaning', 'shopping', 'school', 'work',
  'family', 'maintenance', 'finance', 'health', 'personal', 'other',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const EVENT_TYPES = [
  'birthday', 'anniversary', 'wedding', 'school', 'gathering',
  'religious', 'holiday', 'trip', 'meeting', 'appointment', 'personal', 'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const INVENTORY_KINDS = ['grocery', 'supply'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const INVENTORY_CATEGORIES = [
  'dairy', 'bakery', 'produce', 'meat', 'pantry', 'frozen', 'beverages',
  'snacks', 'spices', 'cleaning', 'toiletries', 'baby', 'pet', 'stationery',
  'tools', 'other',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const UNITS = [
  'piece', 'pack', 'kg', 'g', 'litre', 'ml', 'dozen', 'bottle',
  'box', 'bag', 'can', 'roll', 'metre', 'other',
] as const;
export type Unit = (typeof UNITS)[number];

export const EXPENSE_CATEGORIES = [
  'groceries', 'utilities', 'rent', 'education', 'medical', 'transport',
  'clothing', 'household', 'entertainment', 'dining', 'travel', 'gifts',
  'personal', 'subscriptions', 'maintenance', 'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Payment methods include the locally dominant mobile wallets. These are
 * additive values in a shared list rather than a Pakistan-specific branch in
 * the code — the architecture stays international (docs/01, brief §33).
 */
export const PAYMENT_METHODS = [
  'cash', 'bank_transfer', 'debit_card', 'credit_card',
  'easypaisa', 'jazzcash', 'cheque', 'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BILL_TYPES = ['utility', 'rent', 'subscription', 'fee', 'insurance', 'other'] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const BILL_STATUSES = ['upcoming', 'due', 'overdue', 'paid', 'cancelled'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const UTILITY_KINDS = [
  'electricity', 'gas', 'water', 'internet', 'mobile', 'telephone',
  'tv', 'waste', 'security', 'other',
] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

export const REMINDER_STATUSES = ['pending', 'sent', 'snoozed', 'dismissed', 'missed'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const SHOPPING_LIST_STATUSES = ['open', 'completed', 'archived'] as const;
export type ShoppingListStatus = (typeof SHOPPING_LIST_STATUSES)[number];

export const DOCUMENT_VISIBILITIES = ['household', 'adults', 'admins', 'owner'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const NOTIFICATION_CHANNELS = ['inapp', 'email', 'push', 'sms', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Entity types usable as a polymorphic target (reminders, attachments, audit,
 * notifications, recurrence). Kept as one list so a typo cannot create an
 * unreachable reference.
 */
export const ENTITY_TYPES = [
  'task', 'event', 'reminder', 'bill', 'expense', 'inventory_item',
  'shopping_list', 'appointment', 'medicine', 'medicine_dose', 'document',
  'asset', 'maintenance_record', 'household_member', 'household', 'contact', 'note',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'restore', 'read', 'login', 'logout'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
