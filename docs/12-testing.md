# 12 — Testing Strategy

**Runner:** Vitest everywhere (one runner, one config style, one mental model).

## The shape of the pyramid, and why it is squat

```
      ╱ e2e (a handful — the money paths) ╲
    ╱ API integration (the bulk) ╲
  ╱ unit (pure logic: recurrence, policy, money, time) ╲
```

Deliberately **integration-heavy**. In a CRUD-plus-workflow product, nearly all
real bugs are in the seams: tenant scoping, authorization, transactions,
timezone maths. Unit tests with a mocked DB would pass while all of those are
broken. So: API tests run against a **real Postgres**, not a mock or SQLite.
SQLite would diverge on exactly the features we rely on (partial indexes,
`timestamptz`, advisory locks, FTS).

## Layers

### 1. Unit — pure logic, no I/O
`recurrence` (the big one: ~40 cases — month-end clamping, DST, leap years,
`count` vs `until`, weekday sets), `policy` (the full role × action matrix as a
table-driven test), `money`, `time` (household-timezone boundaries), Zod schemas.

### 2. API integration — the bulk
`fastify.inject()` against a real app instance + a real test database.
- Each test file gets a **fresh schema/database**, migrated once, truncated
  between tests inside a transaction rollback where possible.
- A `testHousehold()` factory builds a household with members in every role, so
  permission cases are one line.

Every resource gets this standard battery:
```
✓ requires authentication                (401)
✓ requires household membership          (404 — not 403; no enumeration oracle)
✓ enforces role permissions per action   (403)
✓ validates input                        (400 + field paths)
✓ paginates / filters / sorts
✓ writes an audit entry on mutation
✓ soft-deletes rather than destroys
✓ cannot read or write across households ← run for EVERY resource
```

The cross-tenant case is non-negotiable and mechanical: a shared helper asserts
it for every registered route, so a new module cannot forget it.

### 3. Workflow tests — §46's compositions
These get their own explicit coverage because they are the product:
- shopping list complete → inventory incremented + expense created + list closed,
  **and rolled back atomically on a forced failure**;
- bill pay → expense created + linked + reminder resolved;
- recurrence job run **twice** → exactly one occurrence (the duplicate guarantee);
- reminder due → notification created → in-app delivery recorded, and **not
  duplicated** on re-run;
- maintenance completed → next due date → reminder scheduled.

### 4. Frontend
Testing Library + jsdom, on behaviour not implementation: forms validate and
submit, list views render all five states, permission-gated nav hides correctly,
quick-add works with keyboard only. Component snapshot tests are avoided —
they fail on every cosmetic change and catch nothing.

### 5. End-to-end (V1)
Playwright, ~6 flows only: sign-up → household → member; quick-add expense;
bill → pay; shopping run; teen login sees no finance; password reset.
Kept small because e2e is where test suites go to become flaky.

## Test data
A `factories.ts` per module (`makeTask({...overrides})`). Deterministic clock
(`vi.setSystemTime`) for every date-dependent test — no test may depend on the
real date. Seed data (`npm run db:seed`) is a realistic demo household, used for
manual QA and as a smoke test that migrations + constraints agree.

## CI gates
`typecheck` → `unit` → `integration` (with a Postgres service) → `build`.
Coverage thresholds only where they mean something: **90% on `core/`**
(recurrence, policy, money, time) and on service layers; no global percentage
target, which just incentivises testing getters.
