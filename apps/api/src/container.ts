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
    dashboard: new DashboardService(db, now),
  };
}
