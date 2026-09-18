# 04 — Data Model & ERD

Database: **PostgreSQL 16**. Schema managed by **Drizzle** with plain-SQL
migrations checked into the repo.

## Conventions (applied to every table)

| Convention | Rule |
| --- | --- |
| Primary key | `uuid` (v7-style, time-ordered — index locality of a sequence, opacity of a UUID) |
| Tenancy | Every household-owned table has `household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE` and it is the **leading column of every composite index** |
| Timestamps | `created_at`, `updated_at` — `timestamptz NOT NULL DEFAULT now()` |
| Authorship | `created_by`, `updated_by` → `users(id) ON DELETE SET NULL` on auditable entities |
| Soft delete | `deleted_at timestamptz` on user-facing entities only (tasks, expenses, bills, members, documents, inventory, events). Reference/child rows hard-delete via cascade |
| Money | `amount_minor bigint` + `currency char(3)`. **Never floats.** PKR has no minor unit in practice but we store ×100 uniformly and format per-currency |
| Dates vs instants | Calendar-facing values (`due_date`, `bill_date`) are `date`. Points in time (`remind_at`, `starts_at`) are `timestamptz`. Mixing these is the #1 source of off-by-one-day bugs |
| Enums | Postgres `text` + `CHECK` constraint, not native `ENUM` — adding a value is a cheap constraint change, not a type migration |
| Naming | `snake_case`, plural tables, `*_id` FKs |

### Why UUID over bigserial
IDs appear in URLs and in an invite flow. Sequential integers leak volume and
allow enumeration. The cost (16 bytes, index locality) is neutralised by
time-ordered UUIDv7.

---

## ERD — core

```
                         ┌───────────────┐
                         │    users      │  authentication identity only
                         │───────────────│
                         │ id            │
                         │ email UQ      │
                         │ password_hash │
                         │ email_verified_at
                         └──────┬────────┘
                                │ 0..1
                                │
┌──────────────┐        ┌───────▼─────────────┐        ┌──────────────┐
│  households  │1──────*│ household_members   │        │   sessions   │
│──────────────│        │─────────────────────│        │──────────────│
│ id           │        │ id                  │        │ token_hash UQ│
│ name         │        │ household_id  FK    │        │ user_id   FK │
│ currency     │        │ user_id  FK NULL ◄──┼── a member may have   │
│ timezone     │        │ display_name        │    NO login at all    │
│ country_code │        │ role                │  (child, helper)      │
│ locale       │        │ relationship        │                       │
│ quiet_hours  │        │ date_of_birth       │                       │
└──────┬───────┘        │ phone / email       │                       │
       │                │ avatar_attachment_id│                       │
       │                │ is_active           │                       │
       │                │ deleted_at          │                       │
       │                └──────────┬──────────┘                       │
       │                           │ assignee / owner / subject       │
       │  ┌────────────────────────┼────────────────────────────┐     │
       │  │                        │                            │     │
┌──────▼──▼──┐  ┌──────────┐  ┌────▼─────┐  ┌──────────┐  ┌─────▼──────┐
│   tasks    │  │  events  │  │ expenses │  │  bills   │  │ inventory_ │
│            │  │          │  │          │  │          │  │   items    │
└─────┬──────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘
      │              │             │             │              │
      └──────────────┴─────┬───────┴─────────────┴──────────────┘
                           │
      ┌────────────────────┼─────────────────────┬──────────────────┐
      │                    │                     │                  │
┌─────▼──────┐  ┌──────────▼────────┐  ┌─────────▼──────┐  ┌────────▼──────┐
│ reminders  │  │ recurring_series  │  │  attachments   │  │  audit_logs   │
│ (polymorph)│  │  (one engine)     │  │  (polymorph)   │  │  (polymorph)  │
└─────┬──────┘  └───────────────────┘  └────────────────┘  └───────────────┘
      │
┌─────▼─────────┐     ┌───────────────────────┐
│ notifications │────*│ notification_deliveries│  (one row per channel attempt)
└───────────────┘     └───────────────────────┘
```

### The central modelling decision: `users` ≠ `household_members`

This is the most important choice in the schema and the brief does not address it.

- A **user** is a login. It has an email and a password hash. It owns nothing.
- A **household_member** is *a person in a household*. It owns tasks, expenses,
  medicines. `user_id` is **nullable**.

Consequences, all of them good:
- A 4-year-old or a domestic helper is assignable with no account (persona 5's veto).
- One user can be a member of several households (their own + their parents').
- Inviting someone later just sets `user_id` on an existing member row —
  **history is preserved**, nothing is re-parented.
- Deleting a user does not orphan household data; the member row survives with
  `user_id = NULL`.

Unique constraints:
```sql
UNIQUE (household_id, user_id) WHERE user_id IS NOT NULL  -- a user joins a household once
```

---

## Table inventory

### Identity & tenancy
| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Login identity | `email` (citext, UQ), `password_hash`, `email_verified_at`, `failed_login_count`, `locked_until` |
| `sessions` | Server-side sessions | `token_hash` (UQ), `user_id`, `expires_at`, `revoked_at`, `ip`, `user_agent`, `last_seen_at` |
| `user_tokens` | Email verify / password reset | `token_hash`, `purpose`, `expires_at`, `consumed_at` |
| `households` | Tenant root | `name`, `currency`, `timezone`, `country_code`, `locale`, `quiet_hours_start/end` |
| `household_members` | People | see above |
| `household_invites` | Pending invites | `email`, `member_id`, `token_hash`, `role`, `expires_at`, `accepted_at` |

### Work
| Table | Notes |
| --- | --- |
| `tasks` | `title`, `description`, `status` (pending/in_progress/completed/cancelled), `priority` (low/normal/high/urgent), `category` (incl. `chore`), `assignee_member_id`, `due_date`, `due_time`, `start_date`, `estimated_minutes`, `completed_at`, `completed_by_member_id`, `series_id`, `occurrence_date` |
| `events` | `title`, `starts_at`, `ends_at`, `all_day`, `location`, `event_type`, `series_id`, `occurrence_date` |
| `event_participants` | `event_id`, `member_id` — M:N |
| `reminders` | Polymorphic: `entity_type`, `entity_id` (both nullable → standalone reminder), `remind_at`, `assignee_member_id`, `priority`, `status`, `series_id` |

### Shopping
| Table | Notes |
| --- | --- |
| `inventory_items` | `kind` (`grocery`/`supply`), `name`, `category`, `unit`, `quantity numeric(12,3)`, `min_quantity`, `location`, `expiry_date`, `brand`, `preferred_brand`, `estimated_price_minor`, `restock_interval_days` |
| `shopping_lists` | `name`, `store`, `status` (`open`/`completed`), `shopper_member_id`, `completed_at` |
| `shopping_list_items` | `list_id`, `inventory_item_id` (nullable — ad-hoc items), `name_snapshot`, `quantity`, `unit`, `priority`, `is_purchased`, `actual_price_minor` |
| `shopping_trips` | Completion record; links a finished list → the created `expense_id` |

`name_snapshot` exists so history reads correctly after an inventory item is
renamed or deleted — a small denormalisation that prevents a class of confusing bugs.

### Money
| Table | Notes |
| --- | --- |
| `expenses` | `amount_minor`, `currency`, `spent_on date`, `category`, `subcategory`, `paid_by_member_id`, `for_member_id`, `payment_method` (cash/bank_transfer/card/easypaisa/jazzcash/cheque/other), `merchant`, `description`, `bill_id` (nullable), `shopping_trip_id` (nullable) |
| `bills` | `bill_type` (utility/rent/subscription/fee/other), `provider_id`, `account_number`, `period_start/end`, `issue_date`, `due_date`, `amount_minor`, `paid_amount_minor`, `paid_on`, `payment_method`, `status` (upcoming/due/overdue/paid/cancelled), `series_id`, `occurrence_date` |
| `providers` | Utility/service providers (K-Electric, SSGC, PTCL, Netflix…) — household-scoped, seeded per country |
| `budgets` | `period` (monthly), `category` (nullable = overall), `amount_minor`, `starts_on`, `ends_on` (nullable) |

**`bills.status` is derived, not authoritative.** It is a materialised convenience
column recomputed by a job and on write; the source of truth is
`paid_on IS NOT NULL` + `due_date` vs today in household timezone. Storing it
lets us index it; recomputing it prevents drift.

### Health (V1)
`doctors` · `appointments` (member, doctor, `scheduled_at`, `status`, `reason`,
`follow_up_date`) · `medicines` (member, `name`, `dose_text`, `frequency`,
`start_date`, `end_date`, `quantity_remaining`, `refill_threshold`,
`prescribed_by_doctor_id`) · `medicine_doses` (generated schedule:
`medicine_id`, `scheduled_at`, `status` taken/skipped/missed, `taken_at`)

`dose_text` is stored **verbatim as free text** ("1 tablet after breakfast"). The
system never parses, computes or normalises it. This is a safety decision.

### Things & upkeep (V1)
`assets` (name, category, brand, model, serial, purchase date/price, warranty
expiry, location, condition) · `maintenance_records` (`asset_id` nullable, type,
performed_on, `cost_minor`, provider, `next_due_date`, warranty info, `series_id`)

### Documents (V1)
`documents` — `name`, `doc_type`, `member_id` (nullable = household document),
`document_number`, `issue_date`, `expiry_date`, `visibility`
(`household`/`adults`/`admins`/`owner`), `attachment_id`

### Platform
| Table | Notes |
| --- | --- |
| `recurrence_rules` | `freq`, `interval`, `by_weekday int[]`, `by_monthday int[]`, `by_month int[]`, `until date`, `count`, `timezone` |
| `recurring_series` | `entity_type`, `recurrence_rule_id`, `template jsonb`, `anchor_date`, `generate_through`, `last_generated_on`, `is_active` |
| `series_occurrences` | Idempotency ledger. `UNIQUE (series_id, occurrence_date)` |
| `attachments` | `entity_type`, `entity_id`, `storage_key`, `filename`, `content_type`, `size_bytes`, `checksum_sha256`, `uploaded_by` |
| `notifications` | `member_id`, `type`, `title`, `body`, `entity_type/id`, `priority`, `read_at`, `dedupe_key` |
| `notification_deliveries` | `notification_id`, `channel`, `status`, `attempts`, `error`, `delivered_at` |
| `audit_logs` | `household_id`, `actor_user_id`, `entity_type`, `entity_id`, `action`, `changes jsonb`, `ip`, `user_agent` |
| `contacts` (V1) | `name`, `category`, `phone`, `whatsapp`, `email`, `address` |
| `notes` (V1) | `title`, `body`, `visibility` |
| `categories` | Household-editable category list per domain (expense/task/inventory), seeded with defaults |

---

## Indexes (the ones that matter)

Every index leads with `household_id`, because every query is tenant-scoped.

```sql
-- the dashboard's hot path: "what is due, for whom"
CREATE INDEX tasks_due_idx    ON tasks (household_id, status, due_date)
  WHERE deleted_at IS NULL;
CREATE INDEX tasks_assignee_idx ON tasks (household_id, assignee_member_id, status, due_date)
  WHERE deleted_at IS NULL;
CREATE INDEX bills_due_idx    ON bills (household_id, status, due_date) WHERE deleted_at IS NULL;
CREATE INDEX events_range_idx ON events (household_id, starts_at);
CREATE INDEX reminders_due_idx ON reminders (household_id, status, remind_at);

-- the scheduler's hot path (NOT household-scoped: it sweeps globally)
CREATE INDEX reminders_pending_global_idx ON reminders (remind_at) WHERE status = 'pending';
CREATE INDEX series_active_idx ON recurring_series (is_active, last_generated_on);

-- money
CREATE INDEX expenses_period_idx ON expenses (household_id, spent_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX expenses_category_idx ON expenses (household_id, category, spent_on);

-- low-stock detection
CREATE INDEX inventory_low_idx ON inventory_items (household_id)
  WHERE deleted_at IS NULL AND min_quantity IS NOT NULL;

-- idempotency
CREATE UNIQUE INDEX series_occurrence_uq ON series_occurrences (series_id, occurrence_date);
CREATE UNIQUE INDEX notif_dedupe_uq ON notifications (household_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- search
CREATE INDEX search_fts_idx ON search_documents USING GIN (search_vector);
```

Partial indexes on `deleted_at IS NULL` keep the soft-delete filter free.

## Constraints worth calling out

```sql
-- money is never negative and always has a currency
CHECK (amount_minor >= 0)
CHECK (currency ~ '^[A-Z]{3}$')

-- a completed task must record when and by whom
CHECK (status <> 'completed' OR completed_at IS NOT NULL)

-- a paid bill must record when
CHECK (status <> 'paid' OR paid_on IS NOT NULL)

-- an event cannot end before it starts
CHECK (ends_at IS NULL OR ends_at >= starts_at)

-- a recurrence rule terminates by date or count, never both
CHECK (NOT (until IS NOT NULL AND count IS NOT NULL))

-- one user is a member of a household at most once
UNIQUE (household_id, user_id) WHERE user_id IS NOT NULL
```

## Soft delete policy

Soft-deleted: `tasks`, `expenses`, `bills`, `household_members`,
`inventory_items`, `documents`, `events`, `assets`, `medicines`.
Reason: they are referenced by history, reports and audit trails; a hard delete
would silently change last month's totals.

Hard-deleted (via cascade): `event_participants`, `shopping_list_items`,
`notification_deliveries`, `series_occurrences`, `sessions`.

**Enforcement:** the `deleted_at IS NULL` filter is applied by the repository
layer, not by each query author. Bypassing requires an explicit
`.withDeleted()` call, which is greppable in review.

## Multi-currency

`households.currency` is the default. `expenses.currency` allows an override for
travel. We store the amount *as entered* and do **not** convert — converted
historical totals require an FX-rate table and a policy on which day's rate
applies, which is out of scope. Reports group by currency and say so rather than
summing incomparable numbers.
