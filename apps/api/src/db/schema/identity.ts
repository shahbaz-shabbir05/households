import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { HOUSEHOLD_ROLES, RELATIONSHIPS, type HouseholdRole, type Relationship } from '@hms/shared';
import { authorship, primaryId, softDelete, timestamps } from './_shared.js';

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * A login. Owns nothing in a household — see `householdMembers` for the person.
 * Splitting these is the most consequential decision in the schema (docs/04).
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    locale: text('locale').notNull().default('en-PK'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Cleared on success; drives lockout with `lockedUntil`. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Set when an account is deleted: the row survives so history stays readable. */
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

/**
 * Server-side sessions. Chosen over JWT so revocation is immediate (docs/07).
 * Only the hash of the token is stored, so a database leak does not yield
 * usable sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expiry_idx').on(t.expiresAt),
  ],
);

/** Single-use, hashed, short-lived tokens for email verification and password reset. */
export const userTokens = pgTable(
  'user_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    purpose: text('purpose').$type<'email_verify' | 'password_reset'>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('user_tokens_hash_uq').on(t.tokenHash),
    index('user_tokens_user_purpose_idx').on(t.userId, t.purpose),
    check('user_tokens_purpose_chk', inList('purpose', ['email_verify', 'password_reset'])),
  ],
);

/** The tenant root. Every household-owned row cascades from here. */
export const households = pgTable(
  'households',
  {
    id: primaryId(),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('PKR'),
    /** All "today"/"due" logic is evaluated in this timezone (docs/05). */
    timezone: text('timezone').notNull().default('Asia/Karachi'),
    countryCode: text('country_code').notNull().default('PK'),
    locale: text('locale').notNull().default('en-PK'),
    weekStartsOn: smallint('week_starts_on').notNull().default(1),
    quietHoursStart: text('quiet_hours_start').default('22:00'),
    quietHoursEnd: text('quiet_hours_end').default('07:00'),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    check('households_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('households_week_start_chk', sql`${t.weekStartsOn} IN (0, 1)`),
  ],
);

/**
 * A person in a household. `userId` is nullable on purpose: a child or a
 * domestic helper is assignable work without ever having an account, and
 * gaining a login later just fills this column, preserving all history.
 */
export const householdMembers = pgTable(
  'household_members',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    role: text('role').$type<HouseholdRole>().notNull().default('adult'),
    relationship: text('relationship').$type<Relationship>().notNull().default('other'),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender').$type<'male' | 'female' | 'other' | 'prefer_not_to_say'>(),
    phone: text('phone'),
    email: text('email'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    notes: text('notes'),
    avatarAttachmentId: uuid('avatar_attachment_id'),
    /** Sparse override map; unset keys fall back to per-type defaults (docs/09). */
    notificationPrefs: jsonb('notification_prefs').$type<Record<string, Record<string, boolean>>>(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    ...softDelete,
    ...authorship,
  },
  (t) => [
    // A user joins any household at most once.
    uniqueIndex('household_members_user_uq')
      .on(t.householdId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index('household_members_household_idx').on(t.householdId, t.isActive),
    index('household_members_user_idx').on(t.userId),
    check('household_members_role_chk', inList('role', HOUSEHOLD_ROLES)),
    check('household_members_relationship_chk', inList('relationship', RELATIONSHIPS)),
  ],
);

/** Binds a login to an existing member row, so assignment history survives. */
export const householdInvites = pgTable(
  'household_invites',
  {
    id: primaryId(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull().references(() => householdMembers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('household_invites_token_uq').on(t.tokenHash),
    index('household_invites_household_idx').on(t.householdId),
    // One live invite per member at a time.
    uniqueIndex('household_invites_open_uq')
      .on(t.memberId)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(householdMembers),
}));

export const householdsRelations = relations(households, ({ many }) => ({
  members: many(householdMembers),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  household: one(households, { fields: [householdMembers.householdId], references: [households.id] }),
  user: one(users, { fields: [householdMembers.userId], references: [users.id] }),
}));
