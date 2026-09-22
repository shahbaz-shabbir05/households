import { config } from '../../config/index.js';
import { LocalDiskDriver } from './local-disk.js';
import type { StorageDriver } from './index.js';

let driver: StorageDriver | null = null;

export function createStorageDriver(): StorageDriver {
  if (driver) return driver;

  switch (config().STORAGE_DRIVER) {
    case 'local':
      driver = new LocalDiskDriver(config().STORAGE_ROOT);
      return driver;
    case 's3':
      // Intentionally not implemented in MVP. The interface is the point: an
      // S3Driver drops in here with no change anywhere else (docs/10).
      throw new Error('The S3 storage driver is not implemented yet — set STORAGE_DRIVER=local');
  }
}

export function setStorageDriver(next: StorageDriver | null): void {
  driver = next;
}
