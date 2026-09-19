# 14 — Deployment Architecture

## Target: boring, one process, one database

```
        Internet
           │ HTTPS (TLS terminated at the edge)
    ┌──────▼───────┐
    │ Reverse proxy│  Caddy / nginx / platform router
    │  + static    │  serves the built SPA, proxies /api → app
    └──────┬───────┘
    ┌──────▼───────┐        ┌──────────────┐        ┌───────────────┐
    │  HMS app     │───────►│ PostgreSQL 16│        │ Object storage│
    │  (Node 22)   │        │  managed     │◄───────│ S3 / R2 / disk│
    │  API + jobs  │        │  + PITR      │        └───────────────┘
    └──────────────┘        └──────────────┘
```

One container runs the API **and** the scheduler. Jobs take Postgres advisory
locks, so scaling to N instances stays correct without a separate worker
deployment. If job volume ever justifies it, `JOBS_ENABLED=false` on web
instances and a dedicated job instance is a config change, not a refactor.

## Environments

| Env | DB | Storage | Notes |
| --- | --- | --- | --- |
| local | local Postgres (or docker) | `./storage` | `npm run db:reset && npm run db:seed` |
| test | `hms_test`, truncated per run | temp dir | CI |
| staging | managed, small | bucket | Seeded demo household |
| production | managed, PITR backups | bucket + versioning | |

## Configuration

12-factor: all config from the environment, validated by a Zod schema at boot.
The process **exits** rather than starting with a missing or default-valued
secret in production — a misconfigured deployment should fail loudly, not run
insecurely. `.env.example` lists every variable with documentation and no values.

## Migrations

Plain SQL files, checked in, applied by `npm run db:migrate` as a **release
step before** the new version starts serving. Rules:
- Forward-only; a rollback is a new migration.
- Expand → migrate → contract for destructive changes, so the previous version
  keeps working during a rolling deploy.
- `/readyz` reports migration currency, so a half-migrated deploy is visible.

## CI/CD

```
push → typecheck → unit → integration (Postgres service) → build
     → [main] → build image → migrate → deploy → smoke test → healthcheck
```

Smoke test after deploy: register → create household → create task → fetch
dashboard, against the real deployment. It catches the class of failure that unit
tests never do (bad config, missing migration, broken storage credentials).

## Scale expectations (sanity check)

A household generates on the order of **tens of rows per day**. 10,000
households ≈ a few million rows a year — a single modest Postgres instance
handles this for years with the indexes in `docs/04`. Any proposal to shard,
cache, or split services should be met with this paragraph first.
