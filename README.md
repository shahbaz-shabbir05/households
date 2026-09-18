# Home Management System (HMS)

A shared operating system for a household: one place that answers **"what does
my family need to know or do right now?"** and makes recording it take seconds.

Bills, tasks, groceries, medicines, appointments, documents and the people they
belong to — wired together so that finishing a shopping trip updates the
inventory *and* records the expense, and paying a bill closes its reminder.

> **Status:** Phase 1 complete (platform, identity, households, members,
> dashboard foundation). See [`docs/15-roadmap.md`](docs/15-roadmap.md) for what
> lands when.

## Read this first

The design work precedes the code. If you are picking this up, read in order:

| Doc | What it settles |
| --- | --- |
| [`docs/00-product-vision.md`](docs/00-product-vision.md) | What this is, what it is not, how success is measured |
| [`docs/01-feature-map-and-mvp.md`](docs/01-feature-map-and-mvp.md) | 23 requested areas consolidated to 12 modules; MVP/V1/V2 split |
| [`docs/16-critique-and-tradeoffs.md`](docs/16-critique-and-tradeoffs.md) | **Where the brief is pushed back on, and why** |
| [`docs/02-personas-and-journeys.md`](docs/02-personas-and-journeys.md) | Who uses it, and the vetoes they hold over the design |
| [`docs/03-information-architecture.md`](docs/03-information-architecture.md) | Navigation: 5 destinations, not 9 |
| [`docs/04-data-model.md`](docs/04-data-model.md) | ERD, conventions, indexes, constraints |
| [`docs/05-system-architecture.md`](docs/05-system-architecture.md) | Modular monolith, layering, jobs, tenancy |
| [`docs/06-api.md`](docs/06-api.md) | REST conventions, error shapes, the aggregate dashboard endpoint |
| [`docs/07-auth-and-permissions.md`](docs/07-auth-and-permissions.md) | Sessions over JWT; the role matrix |
| [`docs/08-recurrence.md`](docs/08-recurrence.md) | One engine, DB-level idempotency |
| [`docs/09-notifications.md`](docs/09-notifications.md) | Channel abstraction, dedupe, quiet hours |
| [`docs/10-files-and-attachments.md`](docs/10-files-and-attachments.md) | Storage driver, authorized download path |
| [`docs/11-frontend.md`](docs/11-frontend.md) | React architecture, five mandatory states, accessibility |
| [`docs/12-testing.md`](docs/12-testing.md) | Integration-heavy, real Postgres |
| [`docs/13-security.md`](docs/13-security.md) | Threat model and controls |
| [`docs/14-deployment.md`](docs/14-deployment.md) | Boring: one process, one database |
| [`docs/adr/`](docs/adr/README.md) | The contested decisions, one line each |

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | Node 22 · TypeScript · Fastify | Small, fast, typed; no framework magic to fight |
| Database | PostgreSQL 16 · Drizzle | SQL-first, so indexes and constraints are visible in the schema |
| Contract | `@hms/shared` (Zod) | One definition of "valid", used by server *and* client |
| Frontend | React 19 · Vite · TanStack Query · Tailwind | Server state handled by a cache that already works |
| Tests | Vitest · real Postgres | The bugs live in the seams, and mocks pass while seams are broken |

## Layout

```
packages/shared    Zod schemas, recurrence engine, money, civil dates — shared by both apps
apps/api           Fastify modular monolith: routes → services → repositories
apps/web           React PWA (mobile-first)
docs/              Design decisions, ADRs
```

## Running it

Requires Node 22+ and PostgreSQL 16+.

```bash
npm install

createdb hms_dev && createdb hms_test          # or use an existing server
cp apps/api/.env.example apps/api/.env         # then set DATABASE_URL

npm run db:migrate
npm run db:seed                                # demo household, 5 members

npm run dev:api                                # http://localhost:3000
npm run dev:web                                # http://localhost:5173
```

Demo login after seeding: `ayesha@example.test` / `demo-password-please-change`.

## Commands

```bash
npm test            # unit + integration (needs hms_test to exist)
npm run typecheck
npm run build
npm run db:migrate  # apply migrations — run before starting a new version
npm run db:reset    # drop, recreate, migrate (development only)
npm run db:seed     # demo data
```

## The three things worth knowing before changing anything

1. **`users` and `household_members` are different things.** A user is a login;
   a member is a person in a household. `household_members.user_id` is nullable
   so a child or a domestic helper can be assigned work without an account.
   ([`docs/04`](docs/04-data-model.md))

2. **Authorization has exactly one home.** `core/policy` answers
   `can(actor, action, resource)`. Repositories enforce household scoping
   structurally; services call `assertCan` before every mutation. The client
   hiding a menu item is never the control.
   ([`docs/07`](docs/07-auth-and-permissions.md))

3. **Recurrence is not duplicated per module.** One engine, one job, per-module
   materialisers, and a unique constraint on `(series_id, occurrence_date)` that
   makes duplicates impossible rather than unlikely.
   ([`docs/08`](docs/08-recurrence.md))

## Conventions

- Money is `{ amountMinor: number, currency: string }`. Never a float, never a
  formatted string.
- Calendar values are civil dates (`YYYY-MM-DD`); points in time are
  `timestamptz`. "Today" is always computed in the household's timezone via
  `core/time`.
- Business logic lives in services. A route containing an `if` about domain
  meaning is in the wrong place.
- A module calls another module's *service*, never its repository or its tables.
