# 01 — Feature Map, Module Consolidation and MVP Definition

## 1. Consolidation: 23 requested modules → 12 real ones

The brief lists ~23 feature areas. Several are the same entity wearing a
different hat. Building them separately would produce duplicate business logic,
duplicate UI, and duplicate bugs — exactly what §45 says to avoid. Consolidations
below are **recommendations with reasons**, not silent decisions.

| Requested (§) | Decision | Reason |
| --- | --- | --- |
| Tasks (§6) + Chores (§7) | **Merge → Tasks** with `category='chore'` and an assignment rotation | A chore *is* a recurring assigned task. Two tables would mean two recurrence engines, two "mark done" flows, two overdue queries. The only real difference is presentation, which is a filter. |
| Grocery Inventory (§4) + Home Inventory (§22) | **Merge → `inventory_items`** with `kind` (`grocery` / `supply`) | Identical fields (qty, unit, min qty, location, expiry). The low-stock rule is the same rule. |
| Appliances (§15) + Assets (§15) | **Merge → `assets`** | Same entity. An appliance is an asset with a service history. |
| Maintenance (§14) | **Keep**, but as `maintenance_records` **linked to an asset** (nullable — "plumbing" has no asset) | Maintenance without the asset link is an orphan log; with it, you get warranty + service history for free. |
| Subscriptions (§16) | **Do not build a separate engine.** A subscription is a recurring bill whose provider is a service. Ship as a *view* over `bills` where `bill_type='subscription'` | Two nearly-identical recurring-money-out engines is the clearest duplication in the brief. One engine, two screens. |
| Bills (§10) + Expenses (§11) | **Keep both, distinct roles.** `bills` = *obligations* (what we owe, when). `expenses` = the *money-out ledger*. Paying a bill writes an expense and links it | Conflating them breaks both: you can't ask "what's due" of a ledger, and you can't ask "what did we spend" of a list of obligations. |
| School/Children (§19) | **Do not build a module.** Ship as: school *contacts*, fee *bills*, homework *tasks*, exam/PTM *events*, all linked to a child member; plus a per-child filtered view | A "Children" module would re-implement tasks, events, bills and contacts with a child FK. The correct primitive is: everything is assignable to a member; children are members. |
| Health Records (§8) | Ship `doctors` + `appointments` + `medicines`. A generic "health records" blob is **`documents` with `type='medical'`** | Avoids a vague third thing nobody knows what to put in. |
| Clothes (§5) | **Defer to V2, and challenge it.** See `docs/16-critique-and-tradeoffs.md` | Highest maintenance-burden-to-value ratio in the brief. A family will not keep a garment inventory current. The *useful* 10% (children's sizes, what needs replacing) is better served by notes on a member + a reminder. |
| Meals & Recipes (§21) | **Future.** | A recipe database is its own product with its own content problem. Its only real tie-in (missing ingredients → shopping list) is a nice-to-have that depends on an ingredient ontology we should not build. |
| Chore points (§7, optional) | **Future, and probably never.** | Gamification of housework has a poor track record and adds a scoring system to maintain. Revisit only if users ask. |
| Family Notes/Journal (§23) | **V1, trivial.** A `notes` table with visibility | Cheap, genuinely used, no logic. |
| Vehicles (§18) | **V2.** Model as an `asset` subtype with vehicle fields + maintenance + reminders | Reuses assets + maintenance + expenses entirely. Small delta, low urgency. |

**Net module list (12):**
Identity & Household · Members · Tasks (incl. chores) · Reminders · Events &
Calendar · Inventory & Shopping · Expenses & Budgets · Bills (incl.
subscriptions) · Health (doctors, appointments, medicines) · Documents ·
Assets & Maintenance · Contacts · (+ Notes, Search, Reports as cross-cutting)

## 2. Cross-cutting capabilities (built once, used by every module)

These are **not features**, they are platform. Building them late means
retrofitting 12 modules.

1. **Tenancy & scoping** — every row belongs to a household; enforced centrally.
2. **Recurrence engine** — one engine, one job, per-module materializers (§27).
3. **Reminder + notification pipeline** — one source of "tell someone something".
4. **Attachments** — one polymorphic store + one authorized download path (§28).
5. **Audit log** — one writer, called from the service layer (§29).
6. **Authorization policy** — one place that answers "may this member do this?"
7. **Search** — one indexed view across entities (§25).
8. **Money** — one representation (integer minor units + currency), one formatter.

## 3. Phasing, with reasons

### MVP — "a real family can use this every day"

The MVP test: **can a family delete their fridge whiteboard and their
bill-reminder WhatsApp messages?** That requires exactly: people, things to do,
dates, and money owed.

| Included | Why it is MVP |
| --- | --- |
| Auth (email/password, reset, verify), sessions | Nothing is usable without it |
| Household + members (incl. non-login members) + invites | The assignment target for everything else |
| Roles & permissions (admin/adult/teen/child/helper) | Children and helpers must not see documents/finances. Retrofitting authz is dangerous |
| Tasks + chores, assignment, recurrence | The single highest-frequency interaction |
| Reminders + in-app notifications | The mechanism the whole product depends on |
| Events + calendar (month/week/agenda) | Birthdays, school events, appointments all render here |
| Inventory + shopping list + low-stock suggestion | The "what do we need" question; highest daily use |
| Expenses + categories + monthly summary | The "what did we spend" question |
| Bills + due/overdue + pay→expense link | The single most expensive failure to prevent |
| Dashboard (Today / This week / Needs attention) | This *is* the product |
| Quick-add for expense, task, grocery, reminder, bill | Survival condition (see vision) |
| Audit log, attachments, search (basic) | Platform — cheaper now than later |

**Deliberately excluded from MVP:** budgets (need 1–2 months of data before they
mean anything), health module (high value but needs careful safety handling and
adds no value in week 1), documents (needs the file pipeline hardened first),
reports/charts (nothing to chart yet), PWA offline (correctness risk before the
data model has settled).

### V1 — "shortly after MVP"

Budgets & budget warnings · Health (doctors, appointments, medicines + dose
schedule + refill thresholds) · Documents with expiry tracking and restricted
visibility · Assets + maintenance + warranty expiry · Contacts · Subscriptions
view · Reports (finance, household) · Email notification channel · Notes ·
CSV export.

*Reason:* each needs either real data (budgets, reports), a hardened file path
(documents), or extra safety review (health) that MVP shouldn't block on.

### V2 — "advanced"

Vehicles · Clothes (reduced scope, see critique) · School/children views ·
Chore rotation & fairness view · PWA offline + install + web push · 2FA · Social
login · Multi-household switching UX · Advanced search (full-text ranking) ·
Shopping "store mode" · Meal plan (basic, no recipe DB).

### Future

Recipes & ingredient ontology · Smart insights (spend anomalies, predicted bill
dates, restock prediction) · OCR receipt capture · Bank/utility integrations ·
WhatsApp/SMS channels · Smart-home.

**On §36 (smart features):** agreed and reinforced — these are *derived* features.
Every one of them requires 3–6 months of reliable data to be anything but noise.
Building them before the data exists produces confidently wrong suggestions,
which destroys trust faster than having no suggestions. The architecture keeps
the door open (append-only ledgers, timestamped history) without building it.

## 4. What the brief is missing

Identified gaps, all marked as **assumptions** where I had to decide:

1. **Invitations & onboarding.** The brief never says how a second person joins.
   *Assumption:* admin creates a member profile, then optionally sends an email
   invite that binds a login to that existing member row.
2. **Member ≠ user.** Never distinguished in the brief. Critical: a 4-year-old
   and a domestic helper need to be assignable without a password.
3. **Leaving a household / deactivating a member.** What happens to their
   assigned tasks and their historical expenses? *Assumption:* members are
   soft-deactivated, never hard-deleted; history is preserved; open assignments
   are surfaced for reassignment.
4. **Multi-household.** §2 says "one or more households" but nothing about
   switching, or a user in two households (e.g. also managing parents' home).
   *Assumption:* a user may hold membership in several households; the UI has an
   explicit household switcher; nothing is ever visible across households.
5. **Timezone.** Absent from the brief and it breaks everything date-related.
   *Assumption:* household-level IANA timezone; all "due today" logic evaluated
   in household time; storage in UTC.
6. **Currency per household** (not per expense only), with per-expense override.
7. **Conflict handling** — two people marking the same task done. *Assumption:*
   last-write-wins with audit trail; no locking (wrong complexity for this).
8. **Data export & deletion** (§32 mentions it, no requirements). *Assumption:*
   household-scoped JSON export by admin; account deletion anonymises the user
   but preserves household financial history, which other members rely on.
9. **Notification quiet hours.** Reminders at 3am will get the app uninstalled.
   *Assumption:* per-household quiet hours, deferring non-urgent notifications.
