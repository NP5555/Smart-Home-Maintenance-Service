# Database

PostgreSQL 16 + PostGIS 3, migrated with [dbmate](https://github.com/amacneil/dbmate)
as plain SQL, with a Prisma client used **read only** for types and queries. The
schema is owned by SQL; Prisma never creates or alters anything.

## Source of truth

`smart-home-docs/04_schema.sql` is canonical. `packages/db/migrations/0001_init.sql`
is a byte-identical copy of it wrapped in dbmate's `-- migrate:up` marker, and a
CI job fails the build if the two ever drift apart. Change the doc first, then
regenerate the migration, so there is only ever one place to review a schema
change.

## Changing the schema

1. Edit `smart-home-docs/04_schema.sql`.
2. Create the migration for the change:
   ```bash
   npm run db:new            # writes packages/db/migrations/<timestamp>_<name>.sql
   ```
   Put the new DDL in the `-- migrate:up` section and the compensating DDL in
   `-- migrate:down`. dbmate refuses to run a migration whose down section is
   empty, which is deliberate: never ship an irreversible change.
3. Apply it:
   ```bash
   npm run db:migrate
   ```
4. Refresh the Prisma client so the generated types match the database:
   ```bash
   npm run db:pull            # prisma db pull, then prisma generate
   ```
   `packages/db/prisma/schema.prisma` is generated output. Commit it, because it
   is what the application compiles against, but never hand-edit it: the next
   `db:pull` will overwrite your change.
5. Re-seed if the change added a table the seed writes to:
   ```bash
   npm run db:seed
   ```

Money is `bigint` paisa everywhere. Timestamps are `timestamptz` in UTC, with
the single exception of `bookings.slot`, which is a `tstzrange` so slot
exclusion can be enforced in the database.

## Local reset

```bash
npm run db:reset            # drop, migrate, db:pull, seed
```

`db:reset` is destructive by design. It is the fastest way to get back to a
known state after a migration experiment.

## Invariants the database enforces

These are not application conventions; they are constraints, and
`apps/api/test/integration/database-invariants.test.ts` proves each one:

| Invariant | Mechanism |
|---|---|
| `audit_log` and `ledger_entries` are append-only | `trg_insert_only` trigger |
| `users` are never physically deleted | `trg_no_delete` trigger |
| Only `BookingStateService.apply()` writes `bookings.status` | `trg_booking_status_guard` requires `app.transition_ctx = 'on'` inside the transaction |
| Every ledger transaction balances | constraint trigger at commit |
| A rating needs a verification | `trg_rating_requires_verification` |
| Submitted verifications are immutable | `trg_verification_immutable` |

If you add an invariant, add it to `04_schema.sql` **and** to that test. A
constraint nobody checks is a comment.

## Seed data

`packages/db/seed` is deterministic and idempotent: running it twice leaves the
database in the same state. Steps run in dependency order and each one upserts,
so a partial seed can be re-run safely.

Development staff accounts are printed on every seed. They share one password
and have no TOTP enrolled, so the first sign-in returns a token flagged
`totpRequired`; call `POST /api/v1/auth/totp/setup` then
`POST /api/v1/auth/totp/verify` to enrol. That is the only path to a staff route.
