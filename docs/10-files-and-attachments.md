# 10 — File & Attachment Architecture

§28 says storage must be independent of the database, and §32 says documents must
never be publicly reachable. Both are satisfied by the same design.

## Storage abstraction

```ts
interface StorageDriver {
  put(key: string, stream: Readable, meta: ObjectMeta): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

- **MVP:** `LocalDiskDriver` — files under `STORAGE_ROOT`, outside the web root,
  never served statically.
- **Production:** `S3Driver` (S3 / R2 / MinIO), same interface. Config switch.

**Files are never stored in the database.** The DB holds only metadata. Reason:
backups stay small and fast, and the DB does not become a file server.

## Key layout

```
households/{householdId}/{entityType}/{yyyy}/{mm}/{uuid}{ext}
```

Keys are **opaque and unguessable** (UUID, never the original filename) and
household-partitioned so a bulk export or household deletion is a prefix
operation.

## The download path — the security-critical part

There is exactly **one** way to read a file:

```
GET /api/v1/attachments/:id/download
  1. authenticate session
  2. load attachment → resolve owning entity
  3. assertCan(ctx, `${entityType}:read`, entity)   ← object-level, incl. visibility
  4. stream from StorageDriver with
       Content-Disposition: attachment; filename="<sanitised>"
       Content-Type: <allow-listed type, never the client-supplied one verbatim>
       Content-Security-Policy: default-src 'none'; sandbox
       X-Content-Type-Options: nosniff
       Cache-Control: private, no-store
```

Consequences:
- No static route, no public bucket, no signed-URL-in-the-page. A leaked URL is
  useless to anyone without a valid session *and* permission.
- Permission is evaluated **per download**, so revoking access is immediate.
- For large files or a future CDN, `S3Driver` can issue a short-lived (≤60s)
  presigned URL — *after* the same authorization check. The check never moves.

## Upload validation

| Control | Rule |
| --- | --- |
| Size | 10 MB per file, 25 MB per request (enforced by `@fastify/multipart`, streaming — never buffered whole) |
| Type | **Allow-list** by extension *and* magic-byte sniff: `jpeg png webp heic pdf`. The client-supplied `Content-Type` is not trusted |
| SVG | **Rejected.** SVG is a script execution vector |
| Filename | Never used as a storage key; sanitised for display; path separators and control chars stripped |
| Integrity | `sha256` stored; enables dedupe and corruption detection |
| Rate | Per-user upload rate limit |
| Malware | Out of scope for MVP; the `StorageDriver.put` seam is where a scanner hooks in. Flagged as a known gap, not silently ignored |

Images are re-encoded (strip EXIF — a receipt photo carries GPS coordinates) and
a thumbnail is generated on upload. **This is a privacy requirement, not an
optimisation.**

## Lifecycle

Attachments are **reference-counted by their owning entity**. Deleting an entity
soft-deletes it; its attachments are marked `pending_delete`. A daily job purges
blobs whose owner has been deleted for >30 days — a grace period so an
accidental delete is recoverable. Orphan blobs (upload succeeded, entity creation
failed) are swept after 24h.
