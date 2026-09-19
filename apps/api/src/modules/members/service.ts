/**
 * Household members — the people in a household.
 *
 * A member is not a login (docs/04). Creating one never creates a user account;
 * an invite later binds a login to the *existing* member row, so every task,
 * expense and appointment already assigned to that person stays attached.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  AcceptInviteInput,
  CreateInviteInput,
  CreateMemberInput,
  HouseholdRole,
  ListMembersQuery,
  Relationship,
  UpdateMemberInput,
} from '@hms/shared';
import { householdInvites, householdMembers, households, users } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { config } from '../../config/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js';
import { diffFields, writeAudit } from '../../core/audit.js';
import { assertCan, can } from '../../core/policy/index.js';
import type { RequestContext, UserContext } from '../../core/request-context.js';
import { addDaysToNow, generateToken, hashToken } from '../../core/tokens.js';
import type { Mailer } from '../../core/mailer.js';

const INVITE_TTL_DAYS = 14;

export interface MemberView {
  id: string;
  displayName: string;
  role: HouseholdRole;
  relationship: Relationship;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  avatarAttachmentId: string | null;
  isActive: boolean;
  /** True when this member can sign in. Drives the "invite" affordance in the UI. */
  hasLogin: boolean;
  isSelf: boolean;
}

export class MemberService {
  constructor(private readonly db: Database) {}

  async list(ctx: RequestContext, query: ListMembersQuery): Promise<MemberView[]> {
    assertCan(ctx, 'member:read');

    const rows = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, ctx.household.id),
          isNull(householdMembers.deletedAt),
          query.includeInactive ? undefined : eq(householdMembers.isActive, true),
          query.role ? eq(householdMembers.role, query.role) : undefined,
        ),
      )
      .orderBy(asc(householdMembers.displayName));

    // A helper may only see their own record; filtering here rather than in the
    // query keeps one policy decision in one place.
    return rows
      .filter((row) => can(ctx, 'member:read', { memberId: row.id }))
      .map((row) => toView(row, ctx.member.id));
  }

  async get(ctx: RequestContext, memberId: string): Promise<MemberView> {
    assertCan(ctx, 'member:read');
    const row = await this.find(ctx.household.id, memberId);
    assertCan(ctx, 'member:read', { memberId: row.id });
    return toView(row, ctx.member.id);
  }

  async create(ctx: RequestContext, input: CreateMemberInput): Promise<MemberView> {
    assertCan(ctx, 'member:create');
    if (input.role === 'admin') assertCan(ctx, 'role:assign');

    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .insert(householdMembers)
        .values({
          householdId: ctx.household.id,
          displayName: input.displayName,
          role: input.role,
          relationship: input.relationship,
          dateOfBirth: input.dateOfBirth ?? null,
          gender: input.gender ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'household_member',
        entityId: member!.id,
        action: 'create',
        summary: `Added ${member!.displayName} as ${member!.role}`,
      });

      return toView(member!, ctx.member.id);
    });
  }

  async update(ctx: RequestContext, memberId: string, input: UpdateMemberInput): Promise<MemberView> {
    const existing = await this.find(ctx.household.id, memberId);

    assertCan(ctx, 'member:update', { memberId: existing.id });

    // Changing a role is a separate, admin-only permission: an adult editing
    // their own profile must not be able to promote themselves.
    if (input.role !== undefined && input.role !== existing.role) {
      assertCan(ctx, 'role:assign');
      await this.assertNotLastAdmin(ctx.household.id, existing, input.role);
    }

    return this.db.transaction(async (tx) => {
      const changes = diffFields(existing as unknown as Record<string, unknown>, input);
      if (!changes) return toView(existing, ctx.member.id);

      const [updated] = await tx
        .update(householdMembers)
        .set({ ...input, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(householdMembers.id, memberId))
        .returning();

      await writeAudit(tx, ctx, {
        entityType: 'household_member',
        entityId: memberId,
        action: 'update',
        changes,
      });

      return toView(updated!, ctx.member.id);
    });
  }

  /**
   * Deactivates rather than deletes. History — who paid for what, who was
   * assigned which task — must stay readable after someone leaves (docs/04).
   */
  async deactivate(ctx: RequestContext, memberId: string): Promise<void> {
    assertCan(ctx, 'member:delete');
    const existing = await this.find(ctx.household.id, memberId);

    if (existing.id === ctx.member.id) {
      throw new ValidationError('You cannot remove yourself from the household');
    }
    await this.assertNotLastAdmin(ctx.household.id, existing, null);

    await this.db.transaction(async (tx) => {
      await tx
        .update(householdMembers)
        .set({ isActive: false, deletedAt: new Date(), updatedBy: ctx.user.id })
        .where(eq(householdMembers.id, memberId));

      await writeAudit(tx, ctx, {
        entityType: 'household_member',
        entityId: memberId,
        action: 'delete',
        summary: `Removed ${existing.displayName} from the household`,
      });
    });
  }

  /** Emails an invite that binds a login to an existing member row. */
  async invite(ctx: RequestContext, mailer: Mailer, input: CreateInviteInput): Promise<void> {
    assertCan(ctx, 'member:invite');

    // Unverified accounts cannot send invites — otherwise an unverified address
    // could be used to spray invitations (docs/07).
    const inviter = await this.db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
      columns: { emailVerifiedAt: true },
    });
    if (!inviter?.emailVerifiedAt) {
      throw new ForbiddenError('Confirm your own email address before inviting others');
    }

    const member = await this.find(ctx.household.id, input.memberId);
    if (member.userId) {
      throw new ConflictError(`${member.displayName} can already sign in`);
    }

    const token = generateToken();

    await this.db.transaction(async (tx) => {
      // Re-inviting replaces any outstanding invite rather than colliding with it.
      await tx
        .update(householdInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(householdInvites.memberId, member.id),
            isNull(householdInvites.acceptedAt),
            isNull(householdInvites.revokedAt),
          ),
        );

      await tx.insert(householdInvites).values({
        householdId: ctx.household.id,
        memberId: member.id,
        email: input.email,
        tokenHash: hashToken(token),
        invitedBy: ctx.user.id,
        expiresAt: addDaysToNow(INVITE_TTL_DAYS),
      });

      await writeAudit(tx, ctx, {
        entityType: 'household_member',
        entityId: member.id,
        action: 'update',
        summary: `Invited ${input.email} to sign in as ${member.displayName}`,
      });
    });

    await mailer.send({
      to: input.email,
      subject: `You have been added to a household on Home Management System`,
      text:
        `${ctx.member.displayName} has invited you to join their household as ${member.displayName}.\n\n` +
        `Accept the invitation (valid for ${INVITE_TTL_DAYS} days):\n` +
        `${config().APP_URL}/accept-invite?token=${token}`,
    });
  }

  /** Binds the signed-in user to the invited member row. */
  async acceptInvite(ctx: UserContext, input: AcceptInviteInput): Promise<{ householdId: string }> {
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const [invite] = await tx
        .update(householdInvites)
        .set({ acceptedAt: now })
        .where(
          and(
            eq(householdInvites.tokenHash, hashToken(input.token)),
            isNull(householdInvites.acceptedAt),
            isNull(householdInvites.revokedAt),
            sql`${householdInvites.expiresAt} > ${now}`,
          ),
        )
        .returning();

      if (!invite) {
        throw new ValidationError('That invitation is invalid or has expired', [
          { path: 'token', message: 'Invalid or expired' },
        ]);
      }

      const alreadyMember = await tx.query.householdMembers.findFirst({
        where: and(
          eq(householdMembers.householdId, invite.householdId),
          eq(householdMembers.userId, ctx.user.id),
          isNull(householdMembers.deletedAt),
        ),
        columns: { id: true },
      });
      if (alreadyMember) {
        throw new ConflictError('You are already a member of that household');
      }

      await tx
        .update(householdMembers)
        .set({ userId: ctx.user.id, isActive: true, updatedAt: now })
        .where(eq(householdMembers.id, invite.memberId));

      return { householdId: invite.householdId };
    });
  }

  private async find(householdId: string, memberId: string) {
    const row = await this.db.query.householdMembers.findFirst({
      where: and(
        eq(householdMembers.id, memberId),
        // Scoping by household here is what makes a cross-household id a 404.
        eq(householdMembers.householdId, householdId),
        isNull(householdMembers.deletedAt),
      ),
    });
    if (!row) throw new NotFoundError('Member');
    return row;
  }

  /**
   * A household with no admin is unadministrable: nobody could invite, assign
   * roles, or change settings again.
   */
  private async assertNotLastAdmin(
    householdId: string,
    member: typeof householdMembers.$inferSelect,
    nextRole: HouseholdRole | null,
  ): Promise<void> {
    if (member.role !== 'admin' || nextRole === 'admin') return;

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.role, 'admin'),
          eq(householdMembers.isActive, true),
          isNull(householdMembers.deletedAt),
        ),
      );

    if ((row?.count ?? 0) <= 1) {
      throw new ValidationError(
        'This is the only admin in the household — make someone else an admin first',
      );
    }
  }
}

function toView(row: typeof householdMembers.$inferSelect, currentMemberId: string): MemberView {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    relationship: row.relationship,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    phone: row.phone,
    email: row.email,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    notes: row.notes,
    avatarAttachmentId: row.avatarAttachmentId,
    isActive: row.isActive,
    hasLogin: row.userId !== null,
    isSelf: row.id === currentMemberId,
  };
}

export { households };
