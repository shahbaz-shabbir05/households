/**
 * Demo data for local development and manual QA.
 *
 * Doubles as a smoke test that the migrations and the CHECK constraints agree
 * with what the application actually writes (docs/12).
 */

import { eq, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { closeDb, getDb } from './client.js';
import { householdMembers, households, users } from './schema/index.js';
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

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, household!.id));

  console.log(`Seeded "${household!.name}" with ${counted?.count ?? 0} members.`);
  console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

seed()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await closeDb();
    process.exit(1);
  });
