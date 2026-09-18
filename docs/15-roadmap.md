# 15 — Development Roadmap

Ordered by **vertical slices** (§44): each phase ships something a user can
actually do, end to end, with tests. No phase is "just the backend".

## Phase 0 — Platform foundations

*Rationale: six cross-cutting systems that every later module depends on.
Building them now makes phase 1 look slow and phases 2–8 fast. Retrofitting
authorization or tenancy into 12 modules is the single most expensive mistake
available to this project.*

- Monorepo, TypeScript, shared Zod contract package
- Postgres + Drizzle + migration runner + seed/reset scripts
- Fastify app: helmet, CORS, rate-limit, cookies, request context, error mapper
- `core/`: errors · money · time (household-tz) · pagination · policy · audit ·
  storage · notifications · recurrence · jobs
- Test harness: real-Postgres integration setup, factories, deterministic clock

## Phase 1 — Identity, household, members, dashboard shell ✅

- Register / login / logout, sessions, CSRF, password reset, email verification
- Household create/update (currency, timezone, quiet hours)
- Members CRUD incl. **login-less members**, roles, invites
- Dashboard endpoint + shell (empty states as onboarding)
- Web: auth screens, app shell (mobile tabs / desktop sidebar), household switcher

**Done when:** a family can sign up, add everyone, and see a dashboard — and the
permission matrix is enforced and tested.

## Phase 2 — Tasks, chores, reminders, events
Tasks with assignment, priority, status, recurrence · chores as a saved view ·
reminders + in-app notifications + the dispatch job · events + calendar
(month/week/agenda) · first quick-add actions.

*Why second:* highest-frequency interaction, and it exercises recurrence +
notifications for real, which shakes out the platform before money is involved.

## Phase 3 — Inventory & shopping
Inventory (groceries + supplies) · low-stock detection · shopping lists grouped
by category/store · **the shopping-trip workflow** (purchase → inventory
restock → expense) · recurring grocery cadence.

*Why third:* the most-used daily loop, and the first true cross-module workflow.

## Phase 4 — Money: expenses, bills, budgets
Expenses + categories + monthly summary · bills with recurrence, due/overdue
derivation, **pay → expense** · subscriptions view · budgets + warnings (V1).

*Why fourth:* highest-value questions ("what's due", "what did we spend"), but
it depends on expenses existing for the shopping workflow, so it follows phase 3.

## Phase 5 — Health
Doctors · appointments + reminders · medicines + generated dose schedule + dose
logging + refill thresholds.

*Why fifth:* high value but safety-sensitive; it should land on a platform whose
recurrence and notification behaviour is already proven in production.

## Phase 6 — Documents, assets, maintenance, contacts
Documents with visibility + expiry tracking · assets + warranty · maintenance
with next-due recurrence · contacts. All lean on the attachment pipeline, which
gets hardened here.

## Phase 7 — Reports, search, export
Finance/household/maintenance reports (few charts, mostly numbers with
comparisons) · global full-text search across entities · CSV/JSON export.

## Phase 8 — V2
Vehicles · clothes (reduced scope) · school/children lens · chore distribution ·
PWA offline reads + install + web push · 2FA · advanced search.

## Future
Recipes & meal planning · smart insights · OCR receipts · integrations ·
additional notification channels.

---

## Milestone definition of done

Every phase must ship with **all** of:
- migrations + seed data
- service-layer authorization, with cross-tenant and wrong-role tests
- audit entries on mutations
- API integration tests incl. validation and pagination
- web UI with the five mandatory states (`docs/11`)
- docs updated if a decision changed

A phase is not done when the endpoints exist. It is done when a user can complete
the journey on a phone.

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Scope: 23 modules, one build** | Never ships | Hard MVP boundary (`docs/01`); consolidation to 12 modules |
| **Abandonment from data-entry burden** | Product dies week 3 | Quick-add as a first-class requirement; auto-derivation (shopping → inventory → expense) over manual upkeep |
| **Recurrence duplicates/gaps** | Silent corruption, lost trust | DB-level idempotency; ~40 unit cases; job runs twice in tests |
| **Timezone/DST bugs** | "Due today" wrong for everyone | One `core/time` helper; household tz; deterministic-clock tests |
| **Authorization hole (teen/cross-tenant)** | Critical breach | Structural scoping + mandatory per-resource tests |
| **Notification spam** | Uninstall | Dedupe keys, quiet hours, digest coalescing |
| **Stale data becomes misleading** | Worse than no data | Decay test per module (`docs/16 §A`) |
| **Attachment leakage** | Critical | No public paths; per-download authorization |
| **Over-engineering (microservices, DB-RBAC, offline writes)** | Cost with no user benefit | Explicitly rejected with reasons in `docs/16` |
