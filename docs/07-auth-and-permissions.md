# 07 — Authentication & Authorization

## Authentication: server-side sessions, not JWT

**Decision: opaque session token in an httpOnly cookie, session record in Postgres.**

| | Opaque session (chosen) | JWT access+refresh |
| --- | --- | --- |
| Revocation | Immediate — delete the row | Not possible until expiry, unless you keep a denylist (i.e. a session table with extra steps) |
| Role change takes effect | Next request | Next refresh (up to 15 min of stale privileges) |
| Cost | One indexed lookup per request | Signature verification |
| Complexity | Low | Refresh rotation, replay detection, clock skew |

For an app holding medical and identity documents, **immediate revocation** is
worth more than saving a primary-key lookup. "Log out all devices" and "remove a
member's access now" must be instant. JWT would be the right call for a
multi-service architecture; we do not have one.

### Password storage
`scrypt` (N=2^16, r=8, p=1, 32-byte key, 16-byte random salt) from Node's
`crypto` — an OWASP-approved KDF with **no native dependency**, behind a
`PasswordHasher` interface with an algorithm tag stored in the hash string
(`scrypt$N=65536,r=8,p=1$salt$hash`). Argon2id is the preferred production
algorithm; the tagged format means swapping it in re-hashes users transparently
on their next successful login. Verification is constant-time
(`crypto.timingSafeEqual`).

### Cookie & CSRF
```
Set-Cookie: hms_session=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=...
```
`SameSite=Lax` blocks cross-site POSTs, and we add **double-submit CSRF tokens**
on all state-changing requests (a non-httpOnly `hms_csrf` cookie echoed in the
`X-CSRF-Token` header, compared in constant time). Defence in depth: `Lax` alone
has known gaps with top-level navigations.

### Session lifecycle
- 30-day sliding expiry; `last_seen_at` updated at most once per 5 minutes
  (avoids a write on every request).
- Rotated on login and on password change.
- **All sessions revoked** on password change or reset.
- Sessions listed in Settings with device/IP/last-seen so a user can revoke one.

### Brute-force & enumeration defence
- Rate limits: 5/min per IP+email on login, 3/hour on password-reset request.
- Account lockout: 10 failed attempts → 15-minute lock (`locked_until`).
- **Uniform responses:** register, login and password-reset return the same shape
  and similar timing whether or not the email exists. "This email is already
  registered" on the signup form is an account-enumeration leak; we send a
  *"check your email"* response and mail either a verification link or a
  "someone tried to sign up with your address" notice.
- Reset/verification tokens: 32 random bytes, **stored hashed**, single-use,
  1-hour (reset) / 24-hour (verify) expiry.

### Email verification is non-blocking
The user can use the app immediately. Unverified accounts cannot: send invites,
change email, or export data. Rationale in `docs/02 §J1`.

## Authorization: a policy module, not a permissions table

See `docs/16 §B.6` for why DB-driven RBAC is premature here.

```ts
// core/policy/index.ts — the ONLY place authorization is decided
can(ctx, 'expense:create')                  // action-level
can(ctx, 'document:read', document)         // object-level
assertCan(ctx, 'task:update', task)         // throws ForbiddenError
```

### Roles

| Role | Intent |
| --- | --- |
| `admin` | Full control incl. members, roles, billing data, documents, deletion |
| `adult` | Normal household data: tasks, money, shopping, events, health. No role management |
| `teen` | Own tasks + shared calendar + shopping list. No finance, no documents, no others' health |
| `child` | Own tasks + shared calendar. Read-mostly |
| `helper` | Assigned tasks only. Nothing else |

### Permission matrix (excerpt — the full matrix is a typed table in code and is unit-tested)

| Action | admin | adult | teen | child | helper |
| --- | :-: | :-: | :-: | :-: | :-: |
| `member:manage` / `role:assign` | ✅ | — | — | — | — |
| `task:create` | ✅ | ✅ | ✅ | ✅ | — |
| `task:update` (any) | ✅ | ✅ | own | own | assigned |
| `expense:read` / `create` | ✅ | ✅ | — | — | — |
| `bill:*` | ✅ | ✅ | — | — | — |
| `document:read` | ✅ | visibility-gated | — | — | — |
| `health:read` (others) | ✅ | ✅ | — | — | — |
| `health:read` (self) | ✅ | ✅ | ✅ | ✅ | — |
| `household:delete` | ✅ | — | — | — | — |

### Object-level rules
Role alone is insufficient. Three object-level dimensions:

1. **Ownership** — `own` in the matrix means `resource.assignee_member_id ===
   ctx.member.id` or `resource.member_id === ctx.member.id`.
2. **Visibility** — `documents` and `notes` carry `visibility`
   (`household` | `adults` | `admins` | `owner`), evaluated *after* the role check.
3. **Tenancy** — enforced structurally by scoped repositories (`docs/05`), so a
   cross-household object never reaches the policy layer at all.

### Enforcement points (all three required)
1. **Repository** — household scope. Structural.
2. **Service** — `assertCan(...)` before every mutation and before returning
   sensitive reads. This is the security boundary.
3. **Route** — role-based route guards as a cheap early rejection, plus nav
   filtering on the client for UX.

The client hiding a menu item is **never** the control. Test suite includes
"teen cannot reach finance endpoints" and "member of household A cannot read
household B" cases for every sensitive route — persona 3's veto, encoded.

### Extensibility seam for custom roles (§30)
`policy` resolves through a `PermissionProvider` interface. MVP ships
`StaticRoleProvider` (the matrix above). A future `DbRoleProvider` reading
`roles`/`role_permissions` can be substituted without touching a single call
site. That is the extensibility §30 asks for, at ~0 cost today.
