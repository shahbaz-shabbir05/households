# 08 — Recurrence Architecture

§27 asks for recurrence on ~10 entity types, and warns about duplicates. That
warning is the whole design problem: recurrence bugs are *silent* and
*multiplying*.

## Rejected approaches, and why

| Approach | Why rejected |
| --- | --- |
| **Store the rule on the entity; on completion, create the next one** | Simple, but you cannot see the future ("what bills are due next month?"), and if an occurrence is never completed the series stops dead. Skipped occurrences vanish from history. |
| **Compute occurrences on the fly, never persist** | Then an occurrence cannot have state — no "this week's rent is paid", no per-occurrence assignee or amount. Fatal for bills and tasks. |
| **A `*_series` table per module** | Correct but multiplies tables and, worse, multiplies *engines*: nine copies of the expansion and idempotency logic that will drift apart. |

## Chosen: one engine, per-module materialisers

```
recurrence_rules      (freq, interval, byWeekday[], byMonthday[], until, count, tz)
        ▲
        │
recurring_series      (entity_type, rule_id, template jsonb, anchor_date,
                       generate_through, last_generated_on, is_active)
        │
        ├─► materialiser registry (code): entityType → (ctx, template, date) => insert
        │
series_occurrences    UNIQUE (series_id, occurrence_date)   ← the idempotency guarantee
        │
        └─► tasks / bills / events / reminders / maintenance / medicine_doses
              (each instance carries series_id + occurrence_date)
```

**The duplicate problem is solved by the database, not by careful code.**
`series_occurrences` has a unique constraint on `(series_id, occurrence_date)`.
The generator inserts the ledger row and the entity row **in one transaction**;
on unique violation it skips. Concurrent generators, retries after a crash, and
a job that runs twice all converge to exactly one occurrence.

### Generation strategy: rolling horizon

Each series materialises occurrences up to `generate_through` (default **90 days**
ahead, or 400 for yearly rules so annual renewals are visible). A job extends the
horizon daily. Bounded horizon means:
- an infinite ("never-ending") recurrence never generates infinite rows;
- the calendar can show real, stateful rows for the next quarter;
- catching up after downtime is a bounded amount of work.

### Rule grammar (an RFC 5545 subset — deliberately not full iCal)

```ts
type RecurrenceRule = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;              // every N periods
  byWeekday?: number[];          // 0=Sun..6=Sat  (weekly)
  byMonthday?: number[];         // 1..31, or -1 = last day (monthly/yearly)
  byMonth?: number[];            // 1..12 (yearly)
  until?: string;                // YYYY-MM-DD, exclusive of neither
  count?: number;                // max occurrences; mutually exclusive with `until`
  timezone: string;              // IANA — expansion happens HERE
};
```

Full RFC 5545 (`BYSETPOS`, `RRULE` strings, `EXDATE` lists) is rejected: it is a
large surface nobody in a family app will use, and it is a well-known source of
implementation bugs. This subset covers every example in the brief: every 2 days,
weekly, monthly, every 3 months, yearly, specific weekdays, end date, never-ending.

### Edge cases handled explicitly (each has a test)

| Case | Rule |
| --- | --- |
| "Monthly on the 31st" in February | Clamp to the last day of the month. Never skip — a rent bill must not vanish in February |
| `byMonthday: [-1]` | Last day of month |
| 29 Feb yearly | Falls to 28 Feb in non-leap years |
| DST boundary | Expansion is done in the rule's timezone, then converted to UTC for storage. "Every day at 08:00" stays 08:00 local across DST |
| `until` + `count` both set | Rejected by a CHECK constraint and by Zod |
| Editing a series | Explicit user choice: *this occurrence only* (detaches the instance: `series_id` kept, `is_detached = true`) or *this and future* (closes the old series with `until = today`, opens a new one). Retroactive edits to past occurrences are never applied — they would rewrite history |
| Deleting an occurrence | Tombstoned in `series_occurrences` with `skipped_at` so regeneration does not resurrect it |

### Per-occurrence overrides
An instance's fields may be edited freely after generation (e.g. this month's
electricity bill is PKR 18,400, not the template's estimate). The generator only
ever **inserts**; it never updates an existing occurrence. That single rule
prevents the classic "the job overwrote my edits overnight" bug.

### Catch-up semantics
If generation has not run for a week, the next run generates every missed
occurrence **whose date is still in the future**, plus, for tasks/bills only, past
occurrences back to `last_generated_on` — because an unpaid bill from last
Tuesday still needs to exist. Reminders whose `remind_at` is in the past are
generated but marked `missed` rather than fired, so users are not hit with a
burst of stale notifications after downtime.
