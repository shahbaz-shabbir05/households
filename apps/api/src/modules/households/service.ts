/**
 * Household (tenant) management.
 *
 * Creating a household also creates the creator's `admin` member row: a
 * household with no members is unreachable, so the two are one transaction.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { CreateHouseholdInput, HouseholdRole, UpdateHouseholdInput } from '@hms/shared';
import { households, householdMembers } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { NotFoundError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan } from '../../core/policy/index.js';
import type { RequestContext, UserContext } from '../../core/request-context.js';

export interface HouseholdSummary {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  countryCode: string;
  locale: string;
  weekStartsOn: 0 | 1;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  role: HouseholdRole;
  memberId: string;
}

/** What the household guard needs to build a `RequestContext`. */
export interface Membership {
  household: RequestContext['household'];
  member: RequestContext['member'];
}

export class HouseholdService {
  constructor(private readonly db: Database) {}

  async create(ctx: UserContext, input: CreateHouseholdInput): Promise<HouseholdSummary> {
    return this.db.transaction(async (tx) => {
      const [household] = await tx
        .insert(households)
        .values({
          name: input.name,
          currency: input.currency,
          timezone: input.timezone,
          countryCode: input.countryCode,
          locale: input.locale,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      const [member] = await tx
        .insert(householdMembers)
        .values({
          householdId: household!.id,
          userId: ctx.user.id,
          displayName: ctx.user.displayName,
          role: 'admin',
          relationship: 'self',
          email: ctx.user.email,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      // The creator has no member row until this point, so the audit entry is
      // written with the row we have just created as the actor.
      await writeAudit(tx, buildBootstrapContext(ctx, household!, member!), {
        entityType: 'household',
        entityId: household!.id,
        action: 'create',
        summary: `Created household "${household!.name}"`,
      });

      return toSummary(household!, member!.role, member!.id);
    });
  }

  /** Every household the user belongs to, for the household switcher. */
  async listForUser(userId: string): Promise<HouseholdSummary[]> {
    const rows = await this.db
      .select({ household: households, role: householdMembers.role, memberId: householdMembers.id })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(
        and(
          eq(householdMembers.userId, userId),
          eq(householdMembers.isActive, true),
          isNull(householdMembers.deletedAt),
          isNull(households.deletedAt),
        ),
      );

    return rows.map((r) => toSummary(r.household, r.role, r.memberId));
  }

  /**
   * Resolves a user's membership of a household. Returns null when the user is
   * not a member — the caller turns that into a 404, never a 403, so the
   * endpoint cannot be used to discover which household ids exist (docs/06).
   */
  async resolveMembership(userId: string, householdId: string): Promise<Membership | null> {
    const row = await this.db
      .select({ household: households, member: householdMembers })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(
        and(
          eq(householdMembers.userId, userId),
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.isActive, true),
          isNull(householdMembers.deletedAt),
          isNull(households.deletedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!row) return null;

    return {
      household: {
        id: row.household.id,
        timezone: row.household.timezone,
        currency: row.household.currency,
        locale: row.household.locale,
        weekStartsOn: (row.household.weekStartsOn === 0 ? 0 : 1) as 0 | 1,
        quietHoursStart: row.household.quietHoursStart,
        quietHoursEnd: row.household.quietHoursEnd,
      },
      member: {
        id: row.member.id,
        role: row.member.role,
        displayName: row.member.displayName,
      },
    };
  }

  async get(ctx: RequestContext): Promise<HouseholdSummary> {
    assertCan(ctx, 'household:read');
    const household = await this.db.query.households.findFirst({
      where: and(eq(households.id, ctx.household.id), isNull(households.deletedAt)),
    });
    if (!household) throw new NotFoundError('Household');
    return toSummary(household, ctx.member.role, ctx.member.id);
  }

  async update(ctx: RequestContext, input: UpdateHouseholdInput): Promise<HouseholdSummary> {
    assertCan(ctx, 'household:update');

    return this.db.transaction(async (tx) => {
      const before = await tx.query.households.findFirst({
        where: and(eq(households.id, ctx.household.id), isNull(households.deletedAt)),
      });
      if (!before) throw new NotFoundError('Household');

      const changes = diffFields(before as unknown as Record<string, unknown>, input);
      if (!changes) return toSummary(before, ctx.member.role, ctx.member.id);

      const [updated] = await tx
        .update(households)
        .set({ ...input, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(households.id, ctx.household.id))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'household',
        entityId: ctx.household.id,
        action: 'update',
        changes,
      });

      return toSummary(updated!, ctx.member.role, ctx.member.id);
    });
  }
}

function toSummary(
  household: typeof households.$inferSelect,
  role: HouseholdRole,
  memberId: string,
): HouseholdSummary {
  return {
    id: household.id,
    name: household.name,
    currency: household.currency,
    timezone: household.timezone,
    countryCode: household.countryCode,
    locale: household.locale,
    weekStartsOn: (household.weekStartsOn === 0 ? 0 : 1) as 0 | 1,
    quietHoursStart: household.quietHoursStart,
    quietHoursEnd: household.quietHoursEnd,
    role,
    memberId,
  };
}

function buildBootstrapContext(
  ctx: UserContext,
  household: typeof households.$inferSelect,
  member: typeof householdMembers.$inferSelect,
): RequestContext {
  return {
    requestId: ctx.requestId,
    user: ctx.user,
    household: {
      id: household.id,
      timezone: household.timezone,
      currency: household.currency,
      locale: household.locale,
      weekStartsOn: (household.weekStartsOn === 0 ? 0 : 1) as 0 | 1,
      quietHoursStart: household.quietHoursStart,
      quietHoursEnd: household.quietHoursEnd,
    },
    member: { id: member.id, role: member.role, displayName: member.displayName },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}
