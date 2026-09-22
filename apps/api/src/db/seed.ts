/**
 * Demo data for local development and manual QA.
 *
 * Doubles as a smoke test that the migrations and the CHECK constraints agree
 * with what the application actually writes (docs/12).
 */

import { eq, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { closeDb, getDb } from './client.js';
import {
  bills,
  budgets,
  householdMembers,
  households,
  inventoryItems,
  providers,
  shoppingListItems,
  shoppingLists,
  users,
} from './schema/index.js';
import { scryptHasher } from '../core/password.js';

const DEMO_EMAIL = 'ayesha@example.test';
const DEMO_PASSWORD = 'demo-password-please-change';

async function seed(): Promise<void> {
  if (config().NODE_ENV === 'production') {
    throw new Error('db:seed refuses to run in production');
  }

  const db = getDb();

  const existing = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${DEMO_EMAIL}`,
    columns: { id: true },
  });
  if (existing) {
    console.log(`Demo data already present (${DEMO_EMAIL}). Run db:reset first to start over.`);
    return;
  }

  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      passwordHash: await scryptHasher.hash(DEMO_PASSWORD),
      displayName: 'Ayesha Khan',
      emailVerifiedAt: new Date(),
    })
    .returning();

  const [household] = await db
    .insert(households)
    .values({
      name: 'Khan Household',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      countryCode: 'PK',
      locale: 'en-PK',
      createdBy: user!.id,
      updatedBy: user!.id,
    })
    .returning();

  // A realistic household: two adults with logins, two children and a helper
  // who are tracked and assignable but have no account (docs/04).
  await db.insert(householdMembers).values([
    {
      householdId: household!.id,
      userId: user!.id,
      displayName: 'Ayesha Khan',
      role: 'admin',
      relationship: 'self',
      email: DEMO_EMAIL,
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      displayName: 'Bilal Khan',
      role: 'adult',
      relationship: 'spouse',
      phone: '+92 300 1234567',
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      displayName: 'Zara Khan',
      role: 'teen',
      relationship: 'child',
      dateOfBirth: '2011-04-18',
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      displayName: 'Hamza Khan',
      role: 'child',
      relationship: 'child',
      dateOfBirth: '2018-09-02',
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      displayName: 'Sana',
      role: 'helper',
      relationship: 'helper',
      phone: '+92 301 7654321',
      createdBy: user!.id,
    },
  ]);

  // A realistic pantry, including a few things already running low so the
  // dashboard suggestion and the "add low stock" action have something to do.
  const pantry = await db
    .insert(inventoryItems)
    .values(
      (
        [
          ['Milk', 'dairy', 'litre', 1, 2, 25000, 2],
          ['Eggs', 'dairy', 'dozen', 0, 1, 40000, 7],
          ['Basmati rice', 'pantry', 'kg', 4, 2, 45000, 30],
          ['Cooking oil', 'pantry', 'litre', 3, 1, 65000, 30],
          ['Sugar', 'pantry', 'kg', 0.5, 1, 18000, 30],
          ['Wheat flour', 'pantry', 'kg', 8, 5, 12000, 15],
          ['Tea', 'beverages', 'pack', 2, 1, 55000, 21],
          ['Yoghurt', 'dairy', 'pack', 2, 1, 15000, 3],
          ['Chicken', 'meat', 'kg', 1, 1, 75000, 7],
          ['Tomatoes', 'produce', 'kg', 2, 1, 12000, 4],
          ['Onions', 'produce', 'kg', 3, 2, 10000, 7],
          ['Dish soap', 'cleaning', 'bottle', 1, 1, 22000, 45],
          ['Toothpaste', 'toiletries', 'piece', 2, 1, 35000, 60],
        ] as const
      ).map(([name, category, unit, quantity, minQuantity, price, cadence]) => ({
        householdId: household!.id,
        name,
        kind: (category === 'cleaning' || category === 'toiletries' ? 'supply' : 'grocery') as
          | 'supply'
          | 'grocery',
        category,
        unit,
        quantity: String(quantity),
        minQuantity: String(minQuantity),
        estimatedPriceMinor: price,
        restockIntervalDays: cadence,
        createdBy: user!.id,
      })),
    )
    .returning({ id: inventoryItems.id, name: inventoryItems.name });

  const [list] = await db
    .insert(shoppingLists)
    .values({
      householdId: household!.id,
      name: 'Weekly shop',
      store: 'Imtiaz',
      createdBy: user!.id,
    })
    .returning();

  // Pre-fill the list with the items that are actually low.
  const lowNames = new Set(['Milk', 'Eggs', 'Sugar']);
  await db.insert(shoppingListItems).values(
    pantry
      .filter((item) => lowNames.has(item.name))
      .map((item) => ({
        householdId: household!.id,
        listId: list!.id,
        inventoryItemId: item.id,
        nameSnapshot: item.name,
        quantity: '2',
      })),
  );

  // Utility providers and their bills: one overdue, one due soon, one paid —
  // so the dashboard has something real to rank on first run.
  const today = new Date();
  const civil = (offsetDays: number) => {
    const d = new Date(today.getTime() + offsetDays * 86_400_000);
    return d.toISOString().slice(0, 10);
  };

  const utilityProviders = await db
    .insert(providers)
    .values(
      (
        [
          ['K-Electric', 'electricity'],
          ['SSGC', 'gas'],
          ['KW&SB', 'water'],
          ['PTCL', 'internet'],
          ['Netflix', 'tv'],
        ] as const
      ).map(([name, utilityKind]) => ({
        householdId: household!.id,
        name,
        utilityKind,
        createdBy: user!.id,
      })),
    )
    .returning({ id: providers.id, name: providers.name });

  const byName = new Map(utilityProviders.map((p) => [p.name, p.id]));

  await db.insert(bills).values([
    {
      householdId: household!.id,
      name: 'Electricity',
      billType: 'utility' as const,
      providerId: byName.get('K-Electric')!,
      accountNumber: 'KE-4471-8820',
      dueDate: civil(-4),
      amountMinor: 1840000,
      currency: 'PKR',
      expenseCategory: 'utilities' as const,
      status: 'overdue' as const,
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      name: 'Internet',
      billType: 'utility' as const,
      providerId: byName.get('PTCL')!,
      accountNumber: 'PTCL-99120',
      dueDate: civil(2),
      amountMinor: 450000,
      currency: 'PKR',
      expenseCategory: 'utilities' as const,
      status: 'due' as const,
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      name: 'Gas',
      billType: 'utility' as const,
      providerId: byName.get('SSGC')!,
      dueDate: civil(11),
      amountMinor: 320000,
      currency: 'PKR',
      expenseCategory: 'utilities' as const,
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      name: 'Netflix',
      billType: 'subscription' as const,
      providerId: byName.get('Netflix')!,
      dueDate: civil(8),
      amountMinor: 125000,
      currency: 'PKR',
      expenseCategory: 'subscriptions' as const,
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      name: 'Rent',
      billType: 'rent' as const,
      dueDate: civil(9),
      amountMinor: 8500000,
      currency: 'PKR',
      expenseCategory: 'rent' as const,
      remindDaysBefore: 5,
      createdBy: user!.id,
    },
  ]);

  await db.insert(budgets).values([
    {
      householdId: household!.id,
      category: 'groceries' as const,
      amountMinor: 5000000,
      currency: 'PKR',
      startsOn: `${new Date().toISOString().slice(0, 7)}-01`,
      createdBy: user!.id,
    },
    {
      householdId: household!.id,
      category: 'utilities' as const,
      amountMinor: 3000000,
      currency: 'PKR',
      startsOn: `${new Date().toISOString().slice(0, 7)}-01`,
      createdBy: user!.id,
    },
  ]);

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, household!.id));

  console.log(
    `Seeded "${household!.name}" with ${counted?.count ?? 0} members, ` +
      `${pantry.length} inventory items, a shopping list, 5 bills and 2 budgets.`,
  );
  console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

seed()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await closeDb();
    process.exit(1);
  });
