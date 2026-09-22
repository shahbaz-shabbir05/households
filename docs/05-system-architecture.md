# 05 — System Architecture

## Shape: modular monolith

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React PWA, mobile-first)                           │
│  TanStack Query cache · httpOnly session cookie · CSRF token │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS  /api/v1
┌───────────────────────────▼──────────────────────────────────┐
│  Fastify app (single Node process)                           │
│                                                              │
│  ── HTTP layer ──────────────────────────────────────────    │
│   helmet · cors · rate-limit · cookie · multipart            │
│   requestContext (requestId, user, household, member, role)  │
│   error mapper (AppError → RFC7807-ish JSON)                 │
│                                                              │
│  ── Modules (vertical slices) ───────────────────────────    │
│   auth │ households │ members │ tasks │ events │ reminders   │
│   inventory │ shopping │ expenses │ bills │ health │ docs    │
│   each = routes.ts → service.ts → repository.ts              │
│                                                              │
│  ── Core (shared, module-agnostic) ──────────────────────    │
│   policy  recurrence  notifications  storage  audit          │
│   pagination  errors  money  time  search  jobs              │
│                                                              │
│  ── Data access ─────────────────────────────────────────    │
│   Drizzle + pg Pool · tenant-scoped query builders           │
└───────────┬─────────────────────────────┬────────────────────┘
            │                             │
    ┌───────▼────────┐            ┌───────▼────────┐
    │  PostgreSQL 16 │            │ Object storage │
    │  (data + FTS   │            │ (local disk →  │
    │   + job locks) │            │  S3-compatible)│
    └────────────────┘            └────────────────┘
```

**No Redis, no message broker, no separate worker service in MVP.** Justified in
`docs/16 §D`: this is a low-write workload and every background job is an
idempotent catch-up sweep. Each of those components is behind an interface, so
adding them later is a swap, not a rewrite.

## Layering rule (the one architectural rule that matters)

```
routes  → HTTP only: parse, validate (Zod), map result to status code.
          Contains NO business logic. If there is an `if` about domain
          meaning in a route, it is in the wrong place.
service → business logic, authorization decisions, transactions,
          audit writes, cross-module orchestration (via ports, not imports
          of another module's repository).
repository → data access. Tenant scoping and soft-delete filtering are
          applied HERE and nowhere else.
```

**Cross-module rule:** a module may import another module's *service interface*,
never its repository or its tables. When `shopping` completes a trip it calls
`expensesService.create(...)` — it never writes to the `expenses` table. This is
what keeps the monolith modular and makes the boundaries real rather than
decorative.

## Tenant scoping — made structurally hard to get wrong

The single most likely serious bug in an app like this is a forgotten
`WHERE household_id = ?`. Rather than rely on discipline:

```ts
// Repositories are constructed with a scope; they cannot be used without one.
const repo = tasksRepository(db, ctx.householdId);
await repo.list({ status: 'pending' });   // household filter is not optional
```

Any query needing to cross households (there are exactly two: the global
scheduler sweep and admin ops) uses an explicitly named `unsafeGlobal*` helper
that is trivial to grep for and is covered by its own tests.

## Request context

Every authenticated request resolves, once, into:

```ts
type RequestContext = {
  requestId: string;
  user: { id: string; email: string };
  household: { id: string; timezone: string; currency: string };
  member: { id: string; role: Role; displayName: string };
  ip: string; userAgent: string;
};
```

Handlers receive it; services take it as their first argument. Audit entries,
policy checks and timezone-sensitive date maths all read from it, so there is one
source of truth for "who is doing this, in which household, in what timezone".

## Background jobs

An in-process scheduler with a **Postgres advisory lock** per job, so running
multiple app instances is safe:

| Job | Cadence | Purpose | Idempotency |
| --- | --- | --- | --- |
| `generateRecurrences` | every 15 min | Materialise upcoming occurrences | `series_occurrences` unique index |
| `dispatchReminders` | every minute | Fire due reminders → notifications | `reminders.status` transition + `dedupe_key` |
| `refreshDerivedStatuses` | hourly | Recompute bill `due`/`overdue`, task overdue | Pure recompute — safe to repeat |
| `stockAndExpiryScan` | daily (per household morning) | Low stock, expiring food, document/warranty expiry | `dedupe_key` per object per day |
| `sessionCleanup` | daily | Purge expired sessions & tokens | Delete-by-predicate |

Every job is a *sweep over current state*, never a queue consumer. If the process
is down for six hours, the next run catches up correctly. That property is what
lets us skip a broker.

## Time handling

- Store instants as `timestamptz` (UTC), calendar dates as `date`.
- "Today", "due", "this week" are computed **in the household's timezone**, via a
  single `core/time.ts` helper. No handler does its own date maths.
- Recurrence expansion happens in the rule's timezone so "every Monday" survives
  DST.

## Observability

- Structured JSON logs (pino) with `requestId`, `householdId`, `userId` on every
  line. **Never** log request bodies for auth, document or health routes.
- `/healthz` (liveness), `/readyz` (DB reachable + migrations current).
- Job runs recorded in a `job_runs` table: started, finished, items processed,
  error. Reason: a silently-not-running reminder job is the worst failure this
  product can have, so it must be visible.

## Caching

**None in MVP, deliberately.** Dashboard queries return in single-digit
milliseconds at household scale (hundreds of rows). A cache here would add
invalidation bugs to solve a problem we do not have. The first cache, if ever
needed, is an HTTP `ETag` on the dashboard endpoint — no new infrastructure.
