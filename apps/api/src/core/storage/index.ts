/**
 * File storage, kept independent of the database (docs/10).
 *
 * Blobs never live in Postgres — backups stay small, and the database does not
 * become a file server. Swapping local disk for S3 is a config change.
 */

import type { Readable } from 'node:stream';

export interface ObjectMeta {
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, stream: Readable, meta: ObjectMeta): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Keys are opaque, unguessable and household-partitioned, so bulk export or
 * household deletion is a prefix operation. The user's filename is never part
 * of the key.
 */
export function buildStorageKey(params: {
  householdId: string;
  entityType: string;
  id: string;
  extension: string;
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = params.extension.replace(/[^a-z0-9.]/gi, '').toLowerCase();
  return `households/${params.householdId}/${params.entityType}/${yyyy}/${mm}/${params.id}${ext}`;
}

export { LocalDiskDriver } from './local-disk.js';
export { createStorageDriver } from './factory.js';
