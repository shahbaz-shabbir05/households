# CI

`ci.yml` runs on every push and pull request:

```
typecheck  →  migrate  →  test (unit + integration)  →  build
```

Typecheck runs first because it is the fastest signal and is what catches a
contract change in `@hms/shared` breaking the API or the web client.

Integration tests run against a real PostgreSQL service container, not a mock
and not SQLite — the bugs this product will actually have live in the seams
(tenant scoping, authorization, transactions, timezone maths), and a mocked
database passes every one of them while they are broken. See
`docs/12-testing.md`.

A production deploy additionally runs `npm run db:migrate` as a release step
*before* the new version starts serving, and a post-deploy smoke test
(register → household → task → dashboard) against the real deployment. See
`docs/14-deployment.md`.
