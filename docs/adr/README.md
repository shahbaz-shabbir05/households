# Architecture Decision Records

Short records of decisions that were *contested* — where a reasonable engineer
would have chosen differently. Each states the alternative and the cost accepted.

| # | Decision | Rationale |
| --- | --- | --- |
| 001 | Modular monolith, not microservices | `docs/05`, `docs/16 §B.9` |
| 002 | Server-side sessions, not JWT | `docs/07` — immediate revocation beats statelessness for a product holding medical and identity data |
| 003 | `users` separate from `household_members` | `docs/04` — members without logins (children, helpers) are a hard requirement |
| 004 | One recurrence engine + JSONB templates, not per-module series tables | `docs/08` — one engine cannot drift from itself |
| 005 | DB unique constraint for recurrence idempotency | `docs/08` — correctness enforced by the database, not by careful code |
| 006 | Code-level policy module, not DB-driven RBAC | `docs/16 §B.6` — five roles cover every household; the extension seam costs nothing |
| 007 | Subscriptions are bills, not a module | `docs/16 §B.3` — avoids two recurring-money engines |
| 008 | Chores are tasks | `docs/01` — one recurrence, one completion flow, one overdue query |
| 009 | Inventory covers groceries and supplies | `docs/01` — identical shape and identical low-stock rule |
| 010 | No Redis / broker; in-process idempotent sweep jobs | `docs/05` — every job is a catch-up sweep, so a broker buys nothing |
| 011 | Postgres FTS, not a search service | `docs/16 §D` |
| 012 | Integer minor units for money | `docs/04` — never a float |
| 013 | Attachments only via an authorized streaming endpoint | `docs/10` — a leaked URL must be worthless |
| 014 | No offline writes in MVP | `docs/16 §B.8` — silent data loss is unacceptable for medicine schedules |
| 015 | 404 (not 403) for cross-household resources | `docs/06` — 403 is an enumeration oracle |
