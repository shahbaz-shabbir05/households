# 16 — Critique, Push-back and Trade-offs

§48 asked me not to simply agree. Here is where I disagree, what I think is
risky, and what I propose instead. Nothing here is silent — every consolidation
in `docs/01` traces back to a reason below.

---

## A. The biggest risk is not technical

**The brief describes ~23 modules and ~200 fields. The failure mode of this
product is not a bug — it is abandonment in week three.**

Every module added is a module the family must *keep current* or it becomes
actively misleading. An inventory that says you have rice when you don't is
worse than no inventory. A maintenance schedule nobody updates produces
permanent false "overdue" badges that train users to ignore all badges.

**Proposal:** each module must pass a *decay test* before being built:

> When this data goes stale, does the app (a) degrade gracefully, (b) become
> useless, or (c) become actively wrong and annoying?

Modules that fail with (c) need an explicit freshness mechanism (a "still
accurate?" prompt, auto-archive of stale items, or derivation from another
module) or they should not ship. Grocery inventory fails this test hardest, which
is why the design decrements inventory *automatically* when a shopping list item
is marked purchased, rather than expecting manual upkeep.

---

## B. Specific disagreements

### 1. Clothes management (§5) — I recommend cutting it, or cutting it down

A per-garment inventory with type, colour, size, brand, purchase date, price,
condition, season, location, notes **and a photo** requires a family to
photograph and catalogue every item of clothing they own, then keep it current as
clothes are worn out, outgrown and given away. No family does this. The data will
be entered once, during the excited first week, and then be wrong forever.

The *real* needs hidden inside §5 are three specific questions:

- "What size is my child now?" → a `size` field with history on the **member**, 2 fields.
- "What do we need to buy before winter/Eid?" → a **shopping list** with a category.
- "What should we donate?" → an occasional **task**, not an inventory.

**Proposal:** ship those three, not a garment database. If users genuinely ask
for full cataloguing, add it in V2 with photo-first capture (photo → item, ~3
taps) rather than a 13-field form. Deferred to V2 and flagged, not silently
dropped.

### 2. Chore points system (§7) — defer, likely drop

Points systems for housework have a well-known failure pattern: they work for
about two weeks, then either the scoring is disputed or the points buy nothing
and are ignored. It also adds a scoring engine, a leaderboard, and arguments
about fairness — permanently, in code.

**Better alternative that costs 1 query:** a *chore distribution* view showing
completed-chore counts per member this month. It surfaces the same fairness
information with no new mechanics, no scoring rules, and nothing to maintain.
That is in V1 reports.

### 3. Subscriptions as a separate module (§16) — duplication

`Subscriptions` and `Bills` have the same shape: a provider, an amount, a
recurrence, a next date, a payment method, an owner, reminders. Building both
means two recurrence integrations, two "mark paid" flows and two overdue
calculations that *will* drift apart.

**Proposal:** one `bills` engine with `bill_type` (`utility | rent |
subscription | fee | other`); "Subscriptions" is a filtered screen. Users see two
sections; we maintain one engine.

### 4. Meal planning + recipes (§21) — out of scope, not just deferred

The stated integration ("if a recipe needs ingredients you don't have, add to
grocery list") requires mapping free-text recipe ingredients to inventory items —
an ontology and fuzzy-matching problem ("2 tbsp oil" vs "Cooking Oil 5L"). Doing
it badly is worse than not doing it: it will suggest buying things you have.

**Proposal:** Future. If it ships, ship the boring 80%: a weekly meal *plan*
(7×4 text slots) with a "add these to shopping list" free-text box. No recipe
database, no ingredient matching.

### 5. "Configurable dashboard" (§3) — not in MVP

A configurable dashboard needs a layout model, a widget registry, per-user
persistence and an editing UI — before we know which widgets matter. Worse, it
lets users hide the very things the product exists to surface.

**Proposal:** MVP ships one opinionated, *priority-ordered* dashboard that
computes what needs attention (overdue > due today > due this week) and shows
sections only when non-empty. Add per-household widget toggles in V1 once we can
see which sections people actually ignore. §3's real requirement — "prioritise
things that actually require attention" — is met by the ranking, not by
configurability.

### 6. Full DB-driven RBAC with a permissions table (§30) — premature

A `roles`/`permissions`/`role_permissions` schema with a UI to edit it is a
multi-week feature that, in a *family* app, will be used by approximately nobody.
Five roles cover every household I can construct: admin, adult, teen, child,
helper.

**Proposal:** permissions as a **code-level policy module** with a single
`can(actor, action, resource)` entry point and a static role→permission matrix,
plus per-resource `visibility` for sensitive rows. This is testable, reviewable
in a diff, and cannot be misconfigured into a security hole by a user at 11pm.
The policy interface is designed so a DB-backed custom-role provider can be
dropped in later without touching call sites. §30's "custom roles for future
extensibility" is satisfied by the *seam*, not by building the machinery now.

### 7. "Encryption where appropriate" (§32) — needs to be made concrete

As written this is a box-tick. Field-level encryption of, say, document numbers
sounds prudent but breaks search and adds a key-management burden with no
attacker model. Meanwhile the *actual* risk in this product is dull and real:
an authenticated member of household A reaching a document belonging to
household B, or a child reaching the household's financial records.

**Proposal:** spend the security budget on (a) mandatory household scoping at the
data-access layer so a missing `WHERE household_id` is impossible to write, (b)
object-level authorization tests for every sensitive route, (c) attachments
served only through authorized, short-lived signed URLs, never public paths, and
(d) encryption at rest at the volume/DB level. Field-level encryption only for
secrets that are never queried — and there are none in MVP.

### 8. Offline-first PWA (§34) — right ambition, wrong phase

Offline write support means conflict resolution, a client-side queue, and a sync
protocol. Doing it before the schema stabilises means rewriting it. Doing it
badly means silent data loss — the worst possible outcome for a product holding
medicine schedules.

**Proposal:** MVP is a *responsive, mobile-first web app* with a fast shell.
V2 adds installability + offline **reads** (cached dashboard) + push. Offline
*writes*, if ever, only for quick-add, with an explicit outbox the user can see.

### 9. Microservices / heavy infra — agreed, and stated as a hard rule

A modular monolith is correct here and will remain correct at 100× this product's
realistic scale. A household app is a low-write, low-concurrency workload. The
one place I would accept extra infrastructure is a job runner, and even that
starts as an in-process scheduler (see §D below).

---

## C. Ambiguities I had to resolve (all flagged as assumptions)

Listed in `docs/01-feature-map-and-mvp.md §4`. The three that most affect the
schema, repeated here because they are the ones most likely to be wrong:

1. **Member vs user.** I assume a household member may exist without a login.
   If instead every member must be a user account, the invite flow and the child
   experience change substantially.
2. **Timezone.** I assume one IANA timezone per household. Families split across
   timezones would break "due today". I judged that rare enough to defer.
3. **Account deletion.** I assume deleting a *user* does not delete *household
   financial history*, because other members depend on it; the user is
   anonymised instead. This is a privacy/utility trade-off that a real product
   would need a policy decision on.

## D. Technical trade-offs taken, with the cost stated

| Decision | Alternative rejected | Cost we accept |
| --- | --- | --- |
| Opaque session cookie in DB | JWT access+refresh | A DB read per request (trivial at this scale) — in exchange for instant revocation and no token-invalidation problem |
| One generic recurrence engine + JSONB template | A `*_series` table per module | Template payload is not DB-typed; mitigated by Zod validation on write **and** read |
| In-process scheduler (`setInterval` + advisory lock) | Redis/BullMQ, external cron | Jobs stop if the app stops; acceptable because all jobs are *idempotent catch-up* jobs, not fire-and-forget. Swappable behind a `JobRunner` interface |
| Postgres full-text (`tsvector`) for search | Elasticsearch/Meilisearch | No fuzzy matching or typo tolerance. Correct call: one less system to run, and search here is over hundreds of rows, not millions |
| Drizzle (SQL-first) over an ORM with a heavy runtime | Prisma / TypeORM | More explicit SQL to write; in exchange, real indexes/constraints are visible in the schema and migrations are plain SQL we can read |
| Soft delete (`deleted_at`) on user-facing entities only | Soft delete everywhere | Every query must filter; centralised in the repository layer to make forgetting it hard |
| Integer minor units for money | Decimal/float | Must remember to divide by 100 at the edges; never a rounding bug |
| Server-rendered permission checks + client hiding | Client-only role checks | Slight duplication of role logic in the UI; the server remains the only authority |

## E. The one thing I would change about the brief

§44 says "build one vertical slice at a time" and §43 says "don't build every
feature at once". Both are right, and they are in tension with a brief that
enumerates 23 modules. The resolution is to be explicit about what *done* means
for phase 1:

> Phase 1 is done when a real family can sign up, add their members, and see a
> dashboard — **and** the cross-cutting platform (tenancy, authz, audit,
> recurrence, notifications, attachments) is in place and tested, because every
> later module depends on all six.

Front-loading the platform makes phase 1 look slower and every subsequent phase
dramatically faster. That is the trade I have made in the implementation order.
