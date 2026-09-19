/**
 * The notification service: the one route from "something became true" to
 * "somebody was told" (docs/09).
 *
 * The three rules that keep this from becoming spam — deduplication, quiet
 * hours and coalescing — live here, so no module has to remember them.
 */

import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { EntityType, NotificationChannel as ChannelName, Priority } from '@hms/shared';
import { householdMembers, notificationDeliveries, notifications, users } from '../../db/schema/index.js';
import type { DbExecutor } from '../../db/client.js';
import { isWithinQuietHours, nextQuietHoursEnd } from '../time.js';
import { ChannelRegistry, inAppChannel, type NotificationRecipient } from './channels.js';

export * from './channels.js';

export interface PublishInput {
  householdId: string;
  /** Members to tell. An empty list is a no-op, not an error. */
  memberIds: string[];
  type: string;
  title: string;
  body?: string | null;
  priority?: Priority;
  entityType?: EntityType | null;
  entityId?: string | null;
  /**
   * Collapses repeats. An overdue bill produces one notification that updates,
   * not one per day. Omit only for genuinely one-off messages.
   */
  dedupeKey?: string | null;
  /** Channels to attempt beyond in-app. */
  channels?: ChannelName[];
}

export interface HouseholdNotificationSettings {
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export class NotificationService {
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Records a notification for each member and queues its deliveries.
   *
   * Returns the ids created or refreshed. Safe to call repeatedly with the same
   * `dedupeKey`: the row is updated in place rather than duplicated, which is
   * what makes the daily scan jobs idempotent.
   */
  async publish(
    db: DbExecutor,
    household: HouseholdNotificationSettings,
    input: PublishInput,
  ): Promise<string[]> {
    if (input.memberIds.length === 0) return [];

    const priority = input.priority ?? 'normal';
    const now = this.now();

    // Urgent messages are never held back; everything else waits for the
    // quiet-hours window to end (docs/09).
    const deferredUntil =
      priority !== 'urgent' &&
      household.quietHoursEnd &&
      isWithinQuietHours(now, household.timezone, household.quietHoursStart, household.quietHoursEnd)
        ? nextQuietHoursEnd(now, household.timezone, household.quietHoursEnd)
        : null;

    const rows = input.memberIds.map((memberId) => ({
      householdId: input.householdId,
      memberId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      priority,
      dedupeKey: input.dedupeKey ?? null,
      deferredUntil,
    }));

    const inserted = await db
      .insert(notifications)
      .values(rows)
      .onConflictDoUpdate({
        target: [notifications.householdId, notifications.memberId, notifications.dedupeKey],
        // The unique index is partial, so Postgres can only infer it when the
        // predicate is restated here. Without this the insert fails outright.
        targetWhere: sql`${notifications.dedupeKey} IS NOT NULL`,
        // A repeat refreshes the message and un-reads it, so a still-unpaid bill
        // resurfaces without stacking up six rows.
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          priority: sql`excluded.priority`,
          updatedAt: sql`now()`,
          readAt: null,
        },
      })
      .returning({ id: notifications.id });

    if (inserted.length === 0) return [];

    const channels: ChannelName[] = ['inapp', ...(input.channels ?? [])];
    await db
      .insert(notificationDeliveries)
      .values(
        inserted.flatMap((n) =>
          channels.map((channel) => ({
            notificationId: n.id,
            channel,
            status: 'pending' as const,
          })),
        ),
      )
      .onConflictDoNothing();

    return inserted.map((n) => n.id);
  }

  /**
   * Attempts every pending delivery whose notification is not deferred.
   * Called by the dispatch job; returns how many were processed.
   */
  async dispatchPending(db: DbExecutor, limit = 200): Promise<number> {
    const now = this.now();

    const pending = await db
      .select({
        deliveryId: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        attempts: notificationDeliveries.attempts,
        notificationId: notifications.id,
        householdId: notifications.householdId,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        priority: notifications.priority,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        memberId: householdMembers.id,
        memberName: householdMembers.displayName,
        memberEmail: householdMembers.email,
        userId: householdMembers.userId,
        userEmail: users.email,
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .innerJoin(householdMembers, eq(householdMembers.id, notifications.memberId))
      .leftJoin(users, eq(users.id, householdMembers.userId))
      .where(
        and(
          eq(notificationDeliveries.status, 'pending'),
          or(isNull(notifications.deferredUntil), lte(notifications.deferredUntil, now)),
        ),
      )
      .limit(limit);

    for (const row of pending) {
      const channel = this.registry.get(row.channel) ?? (row.channel === 'inapp' ? inAppChannel : undefined);
      const recipient: NotificationRecipient = {
        memberId: row.memberId,
        displayName: row.memberName,
        email: row.memberEmail ?? row.userEmail ?? null,
        userId: row.userId,
      };

      if (!channel) {
        await this.markDelivery(db, row.deliveryId, row.attempts, {
          status: 'skipped',
          error: `No channel registered for "${row.channel}"`,
        });
        continue;
      }

      if (!channel.isAvailableFor(recipient)) {
        await this.markDelivery(db, row.deliveryId, row.attempts, {
          status: 'skipped',
          error: 'Channel unavailable for this recipient',
        });
        continue;
      }

      try {
        const result = await channel.deliver(
          {
            id: row.notificationId,
            householdId: row.householdId,
            type: row.type,
            title: row.title,
            body: row.body,
            priority: row.priority,
            entityType: row.entityType,
            entityId: row.entityId,
          },
          recipient,
        );
        await this.markDelivery(db, row.deliveryId, row.attempts, result);
      } catch (error) {
        // A failing channel must never take down the sweep for the others.
        await this.markDelivery(db, row.deliveryId, row.attempts, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return pending.length;
  }

  private async markDelivery(
    db: DbExecutor,
    deliveryId: string,
    attempts: number,
    result: { status: 'sent' | 'failed' | 'skipped'; error?: string },
  ): Promise<void> {
    await db
      .update(notificationDeliveries)
      .set({
        status: result.status,
        attempts: attempts + 1,
        error: result.error ?? null,
        deliveredAt: result.status === 'sent' ? this.now() : null,
        updatedAt: this.now(),
      })
      .where(eq(notificationDeliveries.id, deliveryId));
  }

  async markRead(db: DbExecutor, memberId: string, notificationIds: string[]): Promise<number> {
    if (notificationIds.length === 0) return 0;
    const updated = await db
      .update(notifications)
      .set({ readAt: this.now() })
      .where(
        and(
          eq(notifications.memberId, memberId),
          inArray(notifications.id, notificationIds),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return updated.length;
  }
}
