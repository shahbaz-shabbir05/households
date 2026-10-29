# 11 — Frontend Architecture

**Stack:** React 19 · TypeScript · Vite · React Router · TanStack Query ·
Tailwind CSS v4 · a small in-house component set.

**No UI kit (MUI/Ant/Chakra).** Reasons: the design here is simple (lists, forms,
sheets, a calendar), a kit's bundle and theming layer costs more than it saves on
mobile, and kits make accessibility *look* solved without being solved. We build
~15 primitives, own them, and test them.

## State: three kinds, three tools

| Kind | Tool | Note |
| --- | --- | --- |
| Server state | **TanStack Query** | Nearly all state. Caching, revalidation, optimistic updates, retry |
| URL state | **React Router** search params | Filters, tab, calendar view — shareable and back-button correct |
| Local UI state | `useState` / small context | Sheet open, form draft |

**No Redux/Zustand global store.** Household data is server state; putting it in a
client store means writing a cache and an invalidation strategy that TanStack
Query already implements correctly.

## Structure

```
src/
  app/          router, providers, layout shells (mobile tabs / desktop sidebar)
  components/   ui/ (Button, Input, Sheet, Dialog, Toast, EmptyState, Skeleton…)
                patterns/ (ListPage, DetailPage, QuickAddSheet, DatePicker…)
  features/     one folder per module — mirrors the API modules exactly
    tasks/  { api.ts, hooks.ts, TaskList.tsx, TaskForm.tsx, TaskRow.tsx }
  lib/          apiClient, queryKeys, money, dates, permissions
  styles/
```

`features/*` mirrors backend modules 1:1 so a change to "tasks" is one folder on
each side.

## API client

A thin typed `fetch` wrapper that: sends credentials, attaches the CSRF header on
mutations, parses the `{data}`/`{error}` envelope, throws a typed `ApiError`
carrying `code`, and on `UNAUTHENTICATED` clears the session and redirects once
(not per in-flight request). Response bodies are parsed with the **same Zod
schemas the server validates with** (`@hms/shared`) — a contract break becomes a
loud client error in development instead of a silent `undefined` in production.

## Query key convention

```ts
qk.tasks.list(householdId, filters)   // ['households', hid, 'tasks', 'list', filters]
qk.dashboard(householdId)             // ['households', hid, 'dashboard']
```
Household-prefixed keys mean switching household drops the right cache entries,
and a mutation invalidates `['households', hid, 'tasks']` wholesale without
guessing at filter permutations.

## Mandatory states (enforced by the `ListPage`/`DetailPage` patterns)

Every data view must handle **five** states; the shared pattern components make
skipping one impossible:

1. **Loading** — skeletons shaped like the content, not a spinner (no layout shift).
2. **Empty** — an illustration + one sentence + a primary action. Empty states are
   the onboarding (`docs/02 §J1`), so "No bills yet" is wrong; *"Add your first
   bill — we'll remind you before it's due"* is right.
3. **Error** — what failed, and a retry button. Never a bare stack trace or a toast that vanishes.
4. **Partial/stale** — cached data shown immediately with a subtle refreshing indicator.
5. **Success**.

## Mobile-first specifics

- Touch targets **≥ 44×44 px**; primary actions in the bottom third (thumb reach).
- Creation uses **bottom sheets**, not centred modals — reachable one-handed.
- `inputMode="decimal"` for money, `type="date"` native pickers, `autocomplete`
  hints. Every avoided keystroke matters (persona 1's veto).
- Lists are virtualised past 100 rows.
- Optimistic updates for ticking a task / marking a dose — the interaction must
  feel instant on a 3G connection, with rollback + toast on failure.

## Forms

React Hook Form is *not* used in MVP; forms are small and controlled, validated
with the shared Zod schema on blur and on submit. Server-side field errors
(`error.details[].path`) map onto fields automatically. One validation source of
truth, client and server.

## Accessibility (§41)

Not a checklist item — persona 4 (elder member) is a real user.
Semantic HTML first; ARIA only where semantics run out. Visible focus rings.
Labels on every input (never placeholder-as-label). Colour contrast ≥ 4.5:1, and
**colour is never the only signal** — overdue rows carry an icon and text, not
just red. Dialogs trap focus and restore it. Respect `prefers-reduced-motion`.
Full keyboard operability. Toasts announced via `aria-live="polite"`.

## Charts (§26, §41)

`recharts`, in V1, only where a chart answers a question better than a number:
- Spend by category (donut) — proportion is the question.
- Monthly spend trend (bar, 6 months) — direction is the question.
- Budget vs actual (progress bars) — not a chart at all, which is the point.

Everything else is a number with a comparison ("PKR 48,200 · 12% more than last
month"). No dashboards full of decorative graphs.

## PWA

MVP: manifest + installability + a cached app shell. **No offline writes**
(`docs/16 §B.8`). V2: offline reads of the dashboard, then web push.
