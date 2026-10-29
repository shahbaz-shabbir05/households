/**
 * Delivery channels. A module never calls a provider directly — it publishes a
 * fact, and the dispatcher decides how it leaves the building (docs/09).
 */

import type { NotificationChannel as ChannelName, Priority } from '@hms/shared';

export interface NotificationRecipient {
  memberId: string;
  displayName: string;
  email: string | null;
  userId: string | null;
}

export interface OutboundNotification {
  id: string;
  householdId: string;
  type: string;
  title: string;
  body: string | null;
  priority: Priority;
  entityType: string | null;
  entityId: string | null;
}

export interface DeliveryResult {
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
}

export interface NotificationChannel {
  readonly name: ChannelName;
  /** Cheap check before attempting delivery — no address, no attempt. */
  isAvailableFor(recipient: NotificationRecipient): boolean;
  deliver(notification: OutboundNotification, recipient: NotificationRecipient): Promise<DeliveryResult>;
}

/**
 * In-app delivery. The notification row *is* the delivery, so this only marks
 * the attempt — but it still goes through the channel interface so the
 * dispatcher has no special case.
 */
export const inAppChannel: NotificationChannel = {
  name: 'inapp',
  isAvailableFor: () => true,
  deliver: async () => ({ status: 'sent' }),
};

/**
 * Development email channel: logs instead of sending. Keeps the whole pipeline
 * exercised locally and in tests without a provider or a network call.
 */
export function createConsoleEmailChannel(
  log: (message: string, meta: Record<string, unknown>) => void,
): NotificationChannel {
  return {
    name: 'email',
    isAvailableFor: (recipient) => Boolean(recipient.email),
    async deliver(notification, recipient) {
      if (!recipient.email) return { status: 'skipped', error: 'no email address' };
      log('email.notification', {
        to: recipient.email,
        subject: notification.title,
        body: notification.body,
        type: notification.type,
      });
      return { status: 'sent' };
    },
  };
}

export class ChannelRegistry {
  private readonly channels = new Map<ChannelName, NotificationChannel>();

  register(channel: NotificationChannel): this {
    this.channels.set(channel.name, channel);
    return this;
  }

  get(name: ChannelName): NotificationChannel | undefined {
    return this.channels.get(name);
  }

  all(): NotificationChannel[] {
    return [...this.channels.values()];
  }
}
