# 13 — Security & Privacy

This application holds identity documents, medical information and financial
records for a family, including minors. §32 correctly calls security a
first-class requirement. The practical question is *where to spend the budget*.

## Threat model (who actually attacks this)

| Threat | Likelihood | Impact | Where we spend |
| --- | --- | --- | --- |
| **Cross-tenant data access** (household A reads household B) | Med — one forgotten WHERE clause | Critical | Structural scoping + a mandatory test per resource |
| **Intra-household privilege escalation** (a teen reads documents/finances) | **High** — this is a *normal* daily situation, not an attack | High | Object-level policy, tested per route |
| **Credential stuffing** | High | Critical | Rate limits, lockout, strong KDF, session revocation |
| **Attachment leakage** via guessable/public URL | Med | Critical | No public path; per-download authorization |
| **XSS → session theft** | Med | Critical | httpOnly cookies, CSP, React escaping, no `dangerouslySetInnerHTML` |
| **CSRF** | Med | High | SameSite=Lax + double-submit token |
| **SQL injection** | Low | Critical | Parameterised queries only; allow-listed sort/filter columns |
| **Insider (a household admin)** | Low | Med | Audit log; admins legitimately see everything |

The top two are the ones that matter, and neither is exotic. Note that the
second is not a hypothetical attacker — it is a teenager using the app normally.
That is why authorization is tested, not assumed.

## Controls

### Authentication
See `docs/07`. scrypt (swappable to Argon2id via a tagged hash format),
server-side revocable sessions, hashed single-use tokens, lockout, uniform
responses to prevent account enumeration, all sessions revoked on password change.

### Authorization
Three enforcement points (repository / service / route), one policy module, no
client-side security. Every sensitive route has an explicit "wrong role" and
"wrong household" test.

### Transport & headers
HTTPS only; HSTS. Via `@fastify/helmet`:
```
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:;
  object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```
No inline scripts (nonce-based if ever needed). CORS: an explicit origin
allow-list with credentials; never `*`.

### Input handling
Every request body, query and param is parsed by a Zod schema at the boundary;
unknown keys are stripped (so mass-assignment cannot set `role` or
`household_id`). Output is JSON — React escapes by default. Sort/filter
parameters are matched against an allow-list of column names, never interpolated.

### Data protection
- **At rest:** encrypted volume / managed-Postgres encryption. Field-level
  encryption is deliberately *not* used in MVP — see `docs/16 §B.7` for why it
  would be a box-tick that breaks search without addressing the real threat.
- **In transit:** TLS everywhere, including app→DB in production.
- **Secrets:** environment only; never in the repo. `.env.example` documents the
  names with no values. Config is validated at boot and the process **refuses to
  start** with a default/weak secret in production.
- **Logs:** structured, with an explicit redaction list (`password`, `token`,
  `authorization`, `cookie`, `documentNumber`). Auth, document and health request
  bodies are never logged.
- **PII in errors:** error responses never echo user data back.

### Rate limiting
Global per-IP; stricter per-route on `login` (5/min), `register` (5/hour),
`password/forgot` (3/hour), uploads. Returns `429` with `Retry-After`.

### Audit
`audit_logs` written in the **same transaction** as the change, from the service
layer, recording actor, entity, action, a field-level before/after diff, IP and
user agent. Covers: expenses, bills, documents, members, roles, health records,
tasks, household settings. Reads of *sensitive* entities (documents, health) are
audited too — knowing who *looked* matters as much as who changed.

### Children & minors
A `child`/`teen` role cannot reach finance or documents, cannot change roles, and
cannot see other members' health data. Their own data is visible to household
admins — appropriate for a family product, and stated plainly in the UI rather
than hidden.

## Privacy

- **Data ownership:** data belongs to the *household*. Removing a member removes
  their access, not the household's history.
- **Export:** an admin can export the full household as JSON + files (§32).
- **Deletion:** deleting a *user account* anonymises the user (email replaced
  with a tombstone, password/sessions destroyed) but preserves household
  financial history that other members depend on. Deleting a *household* is a
  hard, confirmed, cascading delete of rows and storage prefix, after a 30-day
  grace period. This trade-off is a policy decision, flagged in `docs/16 §C.3`.
- **EXIF stripping** on uploaded images — a photographed receipt carries the GPS
  location of your home.
- **Minimisation:** we do not collect what we do not use. No analytics SDKs, no
  third-party scripts, no ad/tracking pixels — a CSP without `unsafe-inline` is
  only achievable because of this.

## Backup & recovery

- Nightly `pg_dump` + WAL archiving → offsite, encrypted, 30-day retention.
- Object storage replicated/versioned.
- **Restores are tested on a schedule.** An untested backup is a belief, not a backup.
- Documented RPO ≤ 24h, RTO ≤ 4h for a family-scale product.

## Known gaps (stated, not hidden)

1. No malware scanning of uploads (seam exists in `StorageDriver.put`).
2. No 2FA in MVP (V2) — the highest-value addition after launch.
3. No anomaly detection on logins.
4. Field-level encryption absent by choice, not oversight.
5. A household admin can see everything in their household by design; there is
   no protection against a hostile admin, and the product should not pretend
   otherwise.
