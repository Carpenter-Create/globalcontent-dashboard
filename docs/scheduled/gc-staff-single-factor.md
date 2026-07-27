# `gc_staff` is single-factor, and `gc_staff` is every org

*Written 2026-07-27. **Scoping only — nothing here is built, and the ordering matters more than
the code.** Raised out of audit row C10, which framed this as "MFA for `account_owner` and
`gc_staff`." That framing understates it in one direction and overstates what MFA fixes in
another; both are set out below.*

---

## 1. The exposure

**Authentication is email possession, alone.** `src/app/login/actions.ts` is magic-link only —
`signInWithOtp`, `shouldCreateUser: true`. No password (`minimum_password_length` in
`config.toml` is vestigial; nothing reads it), no OAuth, no MFA. Turnstile is verified server-side
before the send (`actions.ts:21-23`), which raises the cost of *automation* — it says nothing
about *identity*. Whoever reads the mailbox is the user.

**`is_gc_staff` is a membership test and nothing more:**

```sql
select exists (select 1 from public.gc_staff where user_id = p_uid);
```

**`member_can` short-circuits on it before any capability is evaluated:**

```sql
when public.is_gc_staff(p_uid) then true            -- GC scope inverts: all orgs
```

### Measured blast radius

| | Count | Of |
|---|---|---|
| RLS policies referencing `is_gc_staff` directly | **16** | 35 |
| RLS policies routing through `member_can` (which short-circuits) | **22** | 35 |
| Functions calling `is_gc_staff` | **16** | 44 |
| `gc_staff` rows in production | **1** | — |

In the delivery RPCs `is_gc_staff` is the *sole* authorization check —
`if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'` — with no org
scoping, because staff are deliberately unscoped.

So one compromised mailbox yields: read and write across every org's catalog, rights grants,
deliveries, findings and notifications; master-asset and screener URL minting
(`api/gc/asset-url`, `api/gc/screener-url`); vendor export (`api/gc/export`); portal link and
session revocation; and title review approval — the chain-of-title gate itself, since
`review_title` is the sole writer of `in_delivery`.

**Production has one `gc_staff` row.** That is the entire GC-side attack surface today, which is
what makes this cheap now and expensive after hiring.

### The second finding, which is not about MFA at all

`gc_role` has five values — `gc_account_owner`, `gc_accountant`, `gc_legal`, `gc_delivery_ops`,
`gc_viewer` — and **`is_gc_staff` does not consult any of them.** Any row in `gc_staff`, whatever
its role, passes every one of the 16 policy checks and 16 function checks, and gets `true` from
`member_can` for every org.

A `gc_viewer` can today create a delivery, approve a title for delivery, mint a master-asset URL
and revoke a portal session. CLAUDE.md says GC-side roles "mirror these but scope inverts" — the
inversion shipped, the role separation did not.

**This is independent of MFA, cheaper to fix, and arguably the larger hole:** MFA raises the cost
of becoming staff; role separation limits what being staff gets you. C10's framing —
"MFA for `account_owner` and `gc_staff`" — treats `gc_staff` as one principal, which it currently
is, and that is the defect. **Recommend fixing this first regardless of what is decided on MFA.**

---

## 2. What requiring `aal2` would take

### 2a. Where the check goes — two options, real tradeoff

Supabase issues `aal1` after a magic link and `aal2` only after an explicit `mfa.verify`. The
claim rides in the access token, so it is readable in SQL as `auth.jwt() ->> 'aal'`.

> **Verify before relying on it.** The `aal` claim's presence and spelling should be confirmed
> against a real token from this project before any migration is written. Every expression below
> uses `coalesce(auth.jwt() ->> 'aal', 'aal1')` so that a missing claim fails *closed*, but a
> wrong claim *name* would fail closed permanently and lock everyone out. Check it first.

**Option A — fold the check into `is_gc_staff`.** One `create or replace`, no policy changes.

```sql
select exists (select 1 from public.gc_staff where user_id = p_uid)
   and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
```

Every one of the 32 call sites changes meaning at once, which is the appeal and the risk.

*Objection considered and mostly dismissed:* AAL is a property of the **session**, `is_gc_staff`
is a predicate about a **user**, and folding them conflates the two. Checked against reality — all
16 function call sites pass `auth.uid()`, and the only parameterised caller, `member_can(p_uid,…)`,
is itself always invoked with `auth.uid()` from policies. **So today the conflation is harmless.**
It becomes a trap the first time something asks "is *that other* user staff?" — a staff directory,
an admin list, an audit view — because the answer would depend on the *asker's* AAL. Cheap now,
a latent wrong answer later.

**Option B — a separate session predicate.** Keep `is_gc_staff` honest; add:

```sql
create function public.is_gc_staff_session() returns boolean language sql stable
  security definer set search_path = public as $$
  select public.is_gc_staff(auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
```

Then repoint **16 policies and 16 functions**. Correct semantics, ~32-object diff, and every
touched object needs re-verification.

**Recommendation: A now, B when a second staff surface exists.** With one staff row and no admin
listing, B is paying today for a problem that arrives with the second hire — and A is reversible
in one migration.

### 2b. The migration

Either option is `create or replace function`, forward-only, no data change. Notes that apply
either way:

- `create or replace` **preserves the ACL** — verified on this schema this week (`000900` replaced
  `member_can` after `000400` revoked its PUBLIC grant; check C5 confirms the revoke survived). No
  re-grant needed.
- Preserve `stable security definer set search_path = public`. Dropping `search_path` on a
  SECURITY DEFINER function is a privilege-escalation footgun.
- `auth.jwt()` **is** available inside a SECURITY DEFINER function — PostgREST sets
  `request.jwt.claims` as a per-request GUC, and definer rights do not change GUCs. Worth a pgTAP
  assertion rather than trust.
- Option B additionally requires the 32 policy/function replacements in the same migration, since
  a half-applied state is a half-open door.

### 2c. The RLS change, and the trap inside it

16 policies. **One of them must not be changed**, and missing this turns a security improvement
into a lockout:

```
gc_staff_select  [SELECT]  is_gc_staff(auth.uid())
```

`src/app/(app)/(operator)/layout.tsx:15-22` reads the `gc_staff` table to decide whether to show
the operator UI, and **redirects to `/` when the read returns nothing**. If the identity read
requires `aal2`, a staff user at `aal1` cannot see their own staff row, so the app concludes they
are not staff and bounces them to the client dashboard — with no prompt to enrol or verify, and no
error explaining why.

**The identity read must stay at `aal1`; the data must move to `aal2`.** That is the whole design:
you can always learn *that* you are staff, and you can do nothing *as* staff until you step up.

### 2d. The enrollment flow — none of this exists

| Piece | Detail |
|---|---|
| Project config | `[auth.mfa.totp] enroll_enabled` / `verify_enabled` are **`false`** in `config.toml`. Production's project-level setting is **unknown** — check before anything else. Changing it is a `config.toml` edit plus `supabase config push` |
| Enrol UI | `supabase.auth.mfa.enroll({ factorType: 'totp' })` → QR + secret → `challenge` → `verify` to activate. New screen, does not exist |
| Step-up at login | After the magic-link callback, if the user is staff with a verified factor, `mfa.challenge` + `mfa.verify` to reach `aal2`. New screen, does not exist |
| Routing | The operator layout must send `aal1` staff to enrol-or-verify instead of `/`. Today it has one branch — staff or not |
| Recovery | **Supabase issues no recovery codes.** A lost TOTP device locks that user out of every org. `gc_staff` has a SELECT-only policy — no INSERT or UPDATE — so factor removal requires a service-role path, which is a backdoor and must be `audit_log`-ged as loudly as view-as-client |
| Tests | pgTAP for the `aal1`/`aal2` split on each touched policy, and a negative control proving an `aal1` staff token is refused — a passing `aal2` test proves nothing on its own |

### 2e. What breaks for existing staff sessions — the sharp edge

**Existing tokens are `aal1`, and they do not heal.**

- `jwt_expiry = 3600` with `enable_refresh_token_rotation = true`. **A token refresh does not
  raise AAL.** Only an explicit `mfa.verify` does. So a signed-in staff member does not recover by
  waiting, reloading, or being issued a fresh token an hour later.
- The failure is ugly: not a login prompt but `Not authorized` exceptions from RPCs and silently
  empty reads from policies, mid-session.
- **With production at one `gc_staff` row and no factor enrolled, landing the migration before the
  enrollment flow exists locks the only staff account out of every operator surface.** There is no
  second staff user to repair it, and re-granting requires `service_role` — the exact
  break-glass path this change is meant to reduce reliance on.

**The order is therefore forced, and it is the opposite of the tempting one:**

```
1. Verify the `aal` claim name against a real token from this project
2. Enable TOTP at project level (config.toml → config push)
3. Ship enrol + step-up UI, with the identity read still at aal1
4. Enrol the existing staff account and verify aal2 end to end
5. THEN the migration
```

Doing 5 before 3 is a self-inflicted outage on the only staff account.

**Unaffected, and worth stating so the scope is not overestimated:**

- **Client users.** The non-staff branch of `member_can` is untouched.
- **Portal / vendor sessions.** Separate OTP + session chain, no `auth.uid()`.
- **`service_role` paths** — the Stripe webhook and `src/lib/supabase/admin.ts`. These **bypass RLS
  entirely**, so `aal2` protects nothing reached through them. If the concern is "a compromised
  staff mailbox," that is addressed; if it is "a leaked service-role key," this change is
  irrelevant to it.

---

## 3. Rough cost

| Piece | Size |
|---|---|
| Option A migration + pgTAP | Small — one function, a handful of assertions |
| Option B migration + pgTAP | Medium — ~32 objects, each needing re-verification |
| Project config + push | Trivial |
| Enrol + step-up UI, routing | **The bulk of it.** Two new screens, a routing branch, and the error states |
| Recovery path (service-role factor removal + audit) | Small but security-sensitive; needs the same scrutiny as view-as-client |
| Role separation (§1, independent) | Small–medium, and the better first move |

---

## 4. Cheaper things that reduce the same risk today

Offered because the attack path is the **mailbox**, and the most effective control is not in this
repo:

1. **Enforce MFA on the mailbox that receives the magic links.** Zero code, closes the actual
   path, available this morning. Everything above hardens the app against someone who already has
   the mailbox; this stops them having it.
2. **Fix the role-agnostic short-circuit** (§1). Independent of MFA, smaller, and limits what a
   compromise yields.
3. **Supabase network restrictions** (`supabase network-restrictions`) — IP-allowlist the project.
   Blunt, and it complicates CI, but it is a real second factor of a kind.
4. **Shorten `jwt_expiry`.** Not separable per-role today, so it costs client users too. Noted for
   completeness rather than recommended.

---

## 5. What is being asked for

A decision, not code:

- **Do the role separation?** (Recommended yes, independent of the rest.)
- **Do `aal2` for staff — and Option A or B?**
- **If yes, is the enrollment UI in scope now, or does this wait until there is a second staff
  member?** With one staff row, the recovery story is "the founder's phone", and that is a
  single point of failure of a different shape.
