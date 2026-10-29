import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { ObjectMeta, StorageDriver, StoredObject } from './index.js';

/**
 * Development and single-server driver. Files live under a root that is
 * deliberately outside any statically served directory: there is no URL that
 * reaches them, only the authorized download endpoint (docs/10).
 */
export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    const root = path.resolve(this.root);
    // Defence against a key containing `..` — keys are generated, but a storage
    // driver should not depend on its caller being careful.
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, stream: Readable, meta: ObjectMeta): Promise<StoredObject> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(stream, createWriteStream(target, { mode: 0o600 }));
    return { key, sizeBytes: meta.sizeBytes, checksumSha256: meta.checksumSha256 };
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
