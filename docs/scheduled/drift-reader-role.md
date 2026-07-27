# `drift_reader` — a read-one-table credential for the drift check

*Written 2026-07-27. **Proposal awaiting approval. NOT APPLIED, and deliberately not in
`supabase/migrations/`** — a file in that directory is a file `db push` will apply. It moves there
only once the SQL below is approved.*

---

## Why

`migration-drift.yml` no longer needs `SUPABASE_ACCESS_TOKEN` — that reach over 13 projects is
gone. What remains is `SUPABASE_DB_PASSWORD`, which is the `postgres` role: **full read and write
on the production database.** Going from 13 projects to 1 is a large reduction. It is not a
read-only credential, and the workflow needs to read exactly one table:

```sql
select version from supabase_migrations.schema_migrations;
```

**Correction, 2026-07-27: the `postgres` password is already in GitHub.** Both secrets were set on
2026-07-22 — `SECURITY-STATUS.md` and `out-of-repo-results.md` both claimed otherwise for five
days. The owner's ordering ("create the role first so the `postgres` credential never lands in
GitHub") was the right call made on wrong information, and the situation it was meant to prevent
already exists.

**Second correction, later the same day: the stored `postgres` password does not work.** Both
`supabase migration list --db-url` and a plain `psql` are refused by the pooler —
`password authentication failed for user "postgres"` — while the workflow had been passing for
weeks. The explanation, verified by running `migration list --linked` with `SUPABASE_DB_PASSWORD`
unset (exit 0): **`--linked` goes through the Management API and never touches the database
password at all.** The check has been running on `SUPABASE_ACCESS_TOKEN` alone since 2026-07-22,
and `SUPABASE_DB_PASSWORD` has been sitting beside it unused and unvalidated.

So this is **not** a rotation after all — it is the only way to get a working credential that is
not the account token:

- The exposure is smaller than it looked. A wrong password is not a live credential.
- The dependency is larger than it looked. Removing `SUPABASE_ACCESS_TOKEN` is blocked on this
  role existing, because there is nothing else that authenticates to that database today.
- **The schedule is paused** until then, so the check is dormant rather than noisily red.

**`SUPABASE_ACCESS_TOKEN` is nonetheless now unused by any workflow** (as of `dd06151`) and can be
deleted the moment you accept the check staying dormant. It is the account-wide one, reaching 13
projects. **`SUPABASE_DB_PASSWORD` can be deleted immediately** — it authenticates nothing.

---

## The exact SQL, for approval

```sql
-- ============================================================================
-- drift_reader — least-privilege credential for the CI migration-drift check.
--
-- Reads one table. Cannot see application data, cannot write anything, cannot
-- bypass RLS. Created for .github/workflows/migration-drift.yml.
--
-- DESTRUCTIVE OPS: creates a ROLE and grants three privileges. Creates nothing
-- else, alters no table, touches no data. Reversible — see Rollback.
-- ============================================================================

-- LOGIN but nothing else. Explicit rather than relying on defaults, because a
-- default that changes silently is how the table grants decayed.
create role drift_reader with
  login
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit
  nobypassrls
  connection limit 4;

-- No password here, on purpose: this file is in git. Set it out of band, once,
-- and put ONLY that value in the GitHub secret. See "Setting the password".

grant connect on database postgres to drift_reader;
grant usage   on schema supabase_migrations to drift_reader;
grant select  on supabase_migrations.schema_migrations to drift_reader;

-- Belt and braces. The role is granted nothing on `public`, but state it, so a
-- future ALTER DEFAULT PRIVILEGES cannot quietly hand it something.
revoke all on schema public from drift_reader;
alter default privileges in schema public revoke all on tables from drift_reader;

-- Prove it at apply time rather than trusting the statements above.
do $$
begin
  if not has_table_privilege('drift_reader','supabase_migrations.schema_migrations','SELECT')
  then raise exception 'drift_reader cannot read the ledger — the grant did not take'; end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('drift_reader', c.oid, 'SELECT')
  ) then
    raise exception 'drift_reader can read application tables — it must not';
  end if;

  raise notice 'drift_reader: can read the ledger, can read nothing in public';
end $$;
```

The second assertion is the one that matters. The first would pass on a role that could read
*everything*; only the pair together says "this and nothing else."

---

## Setting the password

Not in the migration, not in this file, not in shell history:

```sh
# Run interactively against prod, once. \password prompts and does not echo.
psql "postgresql://postgres.uevsculwzwlhxeamagwg@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
\password drift_reader
```

Then set the one secret — `gh secret set` reads stdin, so the value stays out of history:

```sh
gh secret set SUPABASE_DB_PASSWORD --repo Carpenter-Create/globalcontent-dashboard
```

And update `DB_USER` in `migration-drift.yml` from `postgres.<ref>` to `drift_reader.<ref>`.

---

## Two caveats I could not test without creating the role

1. **Pooler username routing.** Supavisor identifies the tenant from the `<role>.<project-ref>`
   username, so `drift_reader.uevsculwzwlhxeamagwg` *should* work the same way
   `postgres.uevsculwzwlhxeamagwg` does. I have not verified it for a non-`postgres` role on this
   project, and I am not going to assume it. **Verify with one connection before rewiring CI** —
   if the pooler rejects it, the fallback is the direct host, which is IPv6-only and therefore
   unreachable from GitHub runners. That would make this whole approach unworkable and is worth
   knowing in five minutes rather than during a red build.

2. **Custom roles and platform operations.** Roles are cluster-wide, not part of a database dump.
   A restore from `pg_dump` does **not** recreate `drift_reader` — the same reason
   `pg_default_acl` did not survive the `053612Z` restore. Add role recreation to the restore
   runbook alongside re-applying `000300`, or the drift check starts failing after a DR event, at
   the exact moment nobody has attention to spare for it.

---

## Verification, after applying

```sh
# 1. It can read the ledger.
psql "postgresql://drift_reader.<ref>:<pw>@aws-1-us-west-2.pooler.supabase.com:5432/postgres" \
  -c "select count(*) from supabase_migrations.schema_migrations;"        # expect 40

# 2. NEGATIVE CONTROL — it must NOT be able to read application data.
psql "postgresql://drift_reader.<ref>:<pw>@aws-1-us-west-2.pooler.supabase.com:5432/postgres" \
  -c "select count(*) from public.organizations;"                          # expect: permission denied

# 3. The workflow's own command, end to end.
supabase migration list --db-url "postgresql://drift_reader.<ref>:<pw>@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
```

**Step 2 is not optional.** A credential that reads the ledger is the goal; a credential that
reads the ledger *and the catalog* looks identical in step 1.

---

## Rollback

```sql
revoke all on supabase_migrations.schema_migrations from drift_reader;
revoke all on schema supabase_migrations from drift_reader;
revoke connect on database postgres from drift_reader;
drop role drift_reader;
```

Then point `DB_USER` back at `postgres.<ref>` and reset the secret.
