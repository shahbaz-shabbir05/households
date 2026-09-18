# 03 — Information Architecture & Navigation

## Critique of the proposed structure (§37)

The brief's structure is reasonable but has three problems:

1. **It has 9 top-level sections.** On mobile that means a hamburger menu, which
   is where features go to be forgotten. Mobile navigation tolerates ~5 items.
2. **It is organised by data type, not by intent.** "Chores", "Tasks" and
   "Maintenance" are three separate destinations, but a user thinking "what do I
   have to do?" wants *one*.
3. **"Children" as a top-level section** duplicates tasks/events/bills with a
   child filter. It is a *lens*, not a location.

## Proposed structure: 5 destinations + a universal quick-add

Chosen because every top-level item maps to a question a user actually asks.

```
┌─────────────┬──────────────────────────────────────────────────────────┐
│ Destination │ The question it answers                                  │
├─────────────┼──────────────────────────────────────────────────────────┤
│ Today       │ "What needs my attention right now?"                     │
│ Calendar    │ "What's coming up?"                                      │
│   +  (FAB)  │ "Let me record this before I forget"                     │
│ Home        │ "Where is the thing I need to look after?"               │
│ Money       │ "What do we owe and what did we spend?"                  │
│ Family      │ "Who is in this house, and what's theirs?"               │
└─────────────┴──────────────────────────────────────────────────────────┘
```

### Full map

```
Today  (dashboard — the default route)
  ├─ Needs attention  (overdue, ranked)
  ├─ Today            (tasks · bills · doses · appointments · events)
  ├─ This week        (upcoming, collapsed by default)
  └─ Quick actions

Calendar
  ├─ Month / Week / Agenda   (tasks, bills, appointments, events, doses — layered, toggleable)
  ├─ Events
  └─ Reminders

Home
  ├─ Tasks & Chores       (one list; chores are a filter, plus a "Chores" saved view)
  ├─ Shopping             (Shopping list · Inventory · History)
  ├─ Maintenance          (V1)
  ├─ Assets & Appliances  (V1)
  ├─ Vehicles             (V2)
  └─ Notes                (V1)

Money
  ├─ Bills                (Upcoming · Overdue · Paid · Subscriptions view)
  ├─ Expenses
  ├─ Budgets              (V1)
  └─ Reports              (V1)

Family
  ├─ Members              → member detail = the per-person lens
  │    └─ Tasks · Events · Health · Documents · School · Sizes (filtered to that member)
  ├─ Health               (V1: Appointments · Medicines · Doctors)
  ├─ Documents            (V1, permission-gated)
  ├─ Contacts             (V1)
  └─ Settings             (Household · Members & roles · Categories · Notifications · Preferences)
```

### Where the brief's sections went

| Brief section | Location here | Why |
| --- | --- | --- |
| Chores | Home → Tasks (saved view) | Same entity; a second destination would fragment "what must I do" |
| Children/School | Family → Member detail | A lens over tasks/events/bills/documents, not new data |
| Subscriptions | Money → Bills (view) | Same engine (see critique §B.3) |
| Home Inventory | Home → Shopping → Inventory | Same table as groceries, `kind` differs |
| Reminders | Calendar → Reminders | A reminder is a dated thing; it belongs with dates |
| Health records | Family → Health, plus Documents `type=medical` | Avoids a vague catch-all |

## Layout by breakpoint

- **Mobile (< 768px):** bottom tab bar with 5 destinations, centre FAB for
  quick-add. Sub-sections are a segmented control or a list on the destination's
  index page. Sheets (bottom-drawer) for all creation.
- **Tablet (768–1279px):** collapsible left rail + two-column content.
- **Desktop (≥ 1280px):** persistent sidebar with the full tree expanded;
  dashboard becomes a multi-column grid. Modals instead of sheets.

Same routes, same components, same data — only the chrome differs. No separate
mobile app, no divergent code paths.

## Permission-aware navigation

Nav items are filtered by the same policy that guards the API. A `child` role
sees: Today, Calendar, Home (tasks only), Family (members only). "Money" and
"Documents" are absent — not present-and-disabled, which merely advertises them.

**Rule:** hiding nav is UX. The server check is the security boundary. Both
always exist; neither substitutes for the other.

## Routing conventions

```
/                                  → Today
/calendar?view=month|week|agenda
/home/tasks           /home/tasks/:id
/home/shopping        /home/shopping/inventory
/money/bills          /money/bills/:id
/money/expenses
/family               /family/members/:memberId
/settings/*
```

Household context lives in the session (`activeHouseholdId`) rather than in every
URL, keeping links shareable within a household and URLs short. The API, by
contrast, is *explicitly* household-scoped (`/api/v1/households/:id/...`) so that
no server-side handler can accidentally rely on implicit context.
