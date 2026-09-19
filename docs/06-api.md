# 06 — API Architecture

REST over JSON, versioned at `/api/v1`. Chosen over GraphQL because the client is
one first-party app with predictable screens; GraphQL's flexibility buys nothing
here and costs a resolver layer, query-depth limiting and N+1 management.

## Household scoping in the path

```
/api/v1/households/:householdId/tasks
```

Explicit rather than implicit-from-session. A handler physically cannot forget
which household it is operating on, and the `requireHouseholdMember` preHandler
verifies membership + resolves role *before* any handler runs.

Non-scoped routes: `/api/v1/auth/*`, `/api/v1/me`, `/api/v1/households` (list/create).

## Standard shapes

```jsonc
// single
{ "data": { "id": "...", ... } }

// list
{ "data": [ ... ],
  "meta": { "page": 1, "perPage": 25, "total": 137, "totalPages": 6 } }

// error
{ "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [ { "path": "amountMinor", "message": "Expected number" } ],
    "requestId": "01J..."
} }
```

Error codes are a closed set: `VALIDATION_ERROR`, `UNAUTHENTICATED`,
`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`,
`INTERNAL`. The client switches on `code`, never on message text.

**`NOT_FOUND` vs `FORBIDDEN`:** requesting a resource in another household
returns **404, not 403**. 403 would confirm the resource exists — an
enumeration oracle. Within your own household, a permission failure is a real 403.

## Conventions

| Concern | Convention |
| --- | --- |
| Case | `camelCase` in JSON, `snake_case` in DB. Mapped once, in the repository |
| Pagination | `?page=1&perPage=25` (max 100). Cursor pagination reserved for the activity feed |
| Filtering | Explicit allow-listed params per resource (`?status=pending&assigneeId=...&dueBefore=...`). Never a generic query DSL — that is an injection and performance hazard |
| Sorting | `?sort=dueDate&order=asc`, allow-listed columns only |
| Partial update | `PATCH` with a partial Zod schema; `PUT` is not used |
| Idempotency | Mutating quick-add endpoints accept `Idempotency-Key`; replays return the original result. Prevents double-submits on flaky mobile connections |
| Validation | Zod schemas in `@hms/shared`, used by **both** server and client. One definition of "valid" |
| Dates | ISO-8601. `date` fields as `YYYY-MM-DD`, instants with offset |
| Money | Always `{ amountMinor: 125000, currency: "PKR" }`. Never a formatted string, never a float |

## Route surface (MVP)

```
POST   /auth/register                 POST /auth/login          POST /auth/logout
POST   /auth/password/forgot          POST /auth/password/reset
POST   /auth/email/verify             POST /auth/email/resend
GET    /me                            PATCH /me
GET    /households                    POST /households
GET    /households/:id                PATCH /households/:id

GET    /households/:id/members        POST   /households/:id/members
PATCH  /households/:id/members/:mid   DELETE /households/:id/members/:mid
POST   /households/:id/invites        POST   /invites/accept

GET    /households/:id/dashboard      ← the one aggregate endpoint
GET    /households/:id/search?q=

GET|POST         /households/:id/tasks
GET|PATCH|DELETE /households/:id/tasks/:taskId
POST             /households/:id/tasks/:taskId/complete

GET|POST /households/:id/events        GET|POST /households/:id/reminders
GET|POST /households/:id/inventory     GET|POST /households/:id/shopping-lists
POST     /households/:id/shopping-lists/:lid/complete   ← trip → expense + restock
GET|POST /households/:id/expenses      GET|POST /households/:id/bills
POST     /households/:id/bills/:bid/pay                 ← payment → expense

POST   /households/:id/attachments     GET /attachments/:attachmentId/download
GET    /households/:id/notifications   POST /notifications/:nid/read
```

### Why one aggregate `/dashboard` endpoint

The dashboard needs ~8 different slices. Eight parallel requests on a phone on a
slow connection is eight TLS round-trips and eight chances to show a half-loaded
screen. One endpoint returns one coherent snapshot, computed in one transaction,
in the household's timezone. It is the only place we break strict REST
resource-orientation, and it is worth it.

## Cross-module write endpoints

Two endpoints exist purely to make §46's workflows atomic:

- `POST /shopping-lists/:id/complete` → in **one transaction**: mark items
  purchased, increment inventory quantities, create an expense, close the list,
  write audit entries. Partial success here would corrupt both inventory and
  spend.
- `POST /bills/:id/pay` → in one transaction: set `paid_on`/status, create the
  linked expense, resolve the bill's reminder, write audit.

These are the API surface of "modules compose". Doing it client-side with three
calls would guarantee inconsistent data the first time a phone loses signal.
