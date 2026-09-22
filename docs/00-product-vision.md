# 00 — Product Vision

## The one-sentence vision

**HMS is the shared operating system for a household: one place that answers
"what does my family need to know or do right now?" and makes recording it take
seconds, not minutes.**

## The problem, stated honestly

Households already "have a system": a WhatsApp group, a fridge whiteboard, three
different notes apps, a shoebox of receipts, and one person (usually the same
person) who remembers everything. That person is the single point of failure.

The failure modes are specific and repeatable:

| Failure | What it costs |
| --- | --- |
| Bill forgotten until the disconnection notice | Late fees, reconnection charges, a day lost |
| Medicine course abandoned on day 4 | Health outcome, another doctor's visit |
| Groceries bought twice / not at all | Money, an extra trip |
| Nobody knows who was supposed to do it | Resentment, the task not being done |
| Warranty expired last month, unknown | The full cost of a repair |
| Document expiry discovered at the airport | The trip |

Every one of these is a **date that nobody was watching**. That is the core
insight: HMS is fundamentally a system for *obligations with dates attached*,
wrapped in enough context (who, how much, what for) to be actionable.

## The design thesis

1. **Capture must be cheaper than the alternative.** If logging an expense takes
   longer than not logging it, the data rots and the product dies within three
   weeks. Quick-add is not a feature; it is the product's survival condition.
2. **The home screen is the product.** Everything else is storage. A user should
   open the app, see what needs attention today, act, and close it in under
   30 seconds.
3. **Modules must compose.** A shopping list that does not become an expense, a
   bill that does not become a reminder, and a maintenance record that does not
   schedule the next one are three disconnected CRUD screens, not a system.
4. **Nothing decays silently.** Inventory that is never decremented, recurring
   tasks that pile up 400 overdue instances, and reminders nobody dismissed are
   worse than nothing — they train the user to ignore the app.
5. **The household, not the user, is the unit.** Data belongs to the household.
   People join and leave. A member without a login (a child, a helper) is still a
   first-class person you can assign things to.

## What HMS is not

- **Not a personal finance app.** It tracks household money-out well enough to
  answer "what did we spend and what's due", not to replace accounting software,
  reconcile bank feeds, or manage investments.
- **Not a medical system.** It is a *record and reminder* tool. It never
  suggests, adjusts, or interprets dosage or treatment. (Hard requirement — see
  `docs/13-security.md` and the Medicines module rules.)
- **Not a recipe/meal-planning product.** That is a genuinely separate product
  with its own content problem. Scoped to "Future" deliberately.
- **Not a smart-home controller.** No device integration in any planned phase.

## Success measures

The honest measure of this product is **week-4 retention of daily capture**, not
feature count:

- **Primary:** % of households still logging ≥3 events/week after 4 weeks.
- **Secondary:** median time-to-capture for quick-add (target < 15s).
- **Secondary:** % of bills marked paid *before* their due date (the thing the
  product exists to fix).
- **Health/anti-metric:** overdue-item backlog per household. If this grows
  without bound, recurrence generation or dismissal UX is broken.

## Guiding priority order

`simplicity → reliability → usability → maintainability → scalability`

Concretely, when these conflict: we ship one well-wired module rather than three
half-wired ones; we accept a slower query rather than a cache we have to
invalidate correctly; we accept a manual step rather than an automation whose
failure mode is silent.
