/**
 * Composition root.
 *
 * Services are constructed once and handed their dependencies explicitly, so a
 * test can substitute a mailer or a clock without any module-level patching.
 */

import type { FastifyBaseLogger } from 'fastify';
import { config } from './config/index.js';
import { getDb, type Database } from './db/client.js';
import { createConsoleMailer, type Mailer } from './core/mailer.js';
import { ChannelRegistry, NotificationService, createConsoleEmailChannel, inAppChannel } from './core/notifications/index.js';
import { MaterialiserRegistry } from './core/recurrence-service.js';
import { createStorageDriver, type StorageDriver } from './core/storage/index.js';
import { AuthService } from './modules/auth/service.js';
import { HouseholdService } from './modules/households/service.js';
import { MemberService } from './modules/members/service.js';
import { DashboardService } from './modules/dashboard/service.js';
import { TaskService } from './modules/tasks/service.js';
import { taskDashboardContributor } from './modules/tasks/dashboard.js';
import { EventService } from './modules/events/service.js';
import { eventDashboardContributor } from './modules/events/dashboard.js';
import { ReminderService } from './modules/reminders/service.js';
import { reminderDashboardContributor } from './modules/reminders/dashboard.js';
import { ExpenseService } from './modules/expenses/service.js';
import { InventoryService } from './modules/inventory/service.js';
import { ShoppingService } from './modules/shopping/service.js';
import { createShoppingDashboardContributor } from './modules/shopping/dashboard.js';
import { BillService } from './modules/bills/service.js';
import { billDashboardContributor } from './modules/bills/dashboard.js';
import { BudgetService } from './modules/budgets/service.js';

export interface Container {
  db: Database;
  mailer: Mailer;
  storage: StorageDriver;
  channels: ChannelRegistry;
  notifications: NotificationService;
  materialisers: MaterialiserRegistry;
  auth: AuthService;
  households: HouseholdService;
  members: MemberService;
  dashboard: DashboardService;
  tasks: TaskService;
  events: EventService;
  reminders: ReminderService;
  expenses: ExpenseService;
  inventory: InventoryService;
  shopping: ShoppingService;
  bills: BillService;
  budgets: BudgetService;
}

export interface ContainerOverrides {
  db?: Database;
  mailer?: Mailer;
  storage?: StorageDriver;
  now?: () => Date;
}

export function createContainer(log: FastifyBaseLogger, overrides: ContainerOverrides = {}): Container {
  const db = overrides.db ?? getDb();
  const now = overrides.now ?? (() => new Date());
  const mailer =
    overrides.mailer ??
    createConsoleMailer((meta, message) => log.info(meta, message));

  const channels = new ChannelRegistry().register(inAppChannel);
  if (config().EMAIL_DRIVER === 'console') {
    channels.register(createConsoleEmailChannel((message, meta) => log.info(meta, message)));
  }

  const notifications = new NotificationService(channels, now);
  const materialisers = new MaterialiserRegistry();
  const storage = overrides.storage ?? createStorageDriver();

  const tasks = new TaskService(db, now);
  const events = new EventService(db, now);
  const reminders = new ReminderService(db, notifications, now);

  // Shopping composes with expenses and inventory through their services, never
  // their tables — that is what keeps the module boundaries real (docs/05).
  const expenses = new ExpenseService(db, now);
  const inventory = new InventoryService(db, now);
  const shopping = new ShoppingService(db, expenses, inventory, now);
  // Bills compose with expenses and reminders the same way: pay writes the
  // ledger entry and closes the nag, in one transaction.
  const bills = new BillService(db, expenses, reminders, notifications, now);
  const budgets = new BudgetService(db, now);

  // Modules register with the recurrence engine and the dashboard rather than
  // either of those importing modules — that is what keeps the monolith
  // modular (docs/05, docs/08).
  materialisers
    .register('task', tasks.materialiser)
    .register('event', events.materialiser)
    .register('reminder', reminders.materialiser)
    .register('bill', bills.materialiser);

  const dashboard = new DashboardService(db, now);
  dashboard
    .register(taskDashboardContributor)
    .register(reminderDashboardContributor)
    .register(eventDashboardContributor)
    .register(createShoppingDashboardContributor(inventory))
    .register(billDashboardContributor);

  return {
    db,
    mailer,
    storage,
    channels,
    notifications,
    materialisers,
    auth: new AuthService(db, mailer, undefined, now),
    households: new HouseholdService(db),
    members: new MemberService(db),
    dashboard,
    tasks,
    events,
    reminders,
    expenses,
    inventory,
    shopping,
    bills,
    budgets,
  };
}
