# Buyer title page — design

**Date:** 2026-08-06
**Status:** approved in brainstorming; not yet planned or built
**Scope:** the page a buyer sees when a client shares a title with them, from pitch through
to post-licence collection

---

## 1. Purpose

A rights holder pitches a title to a buyer — Tubi, say. They send one link. That link opens a
title page showing the film and its information side by side.

**The same link serves the whole relationship, in two states:**

| State | What the buyer gets |
| --- | --- |
| **At pitch** (no licence) | Trailer, screener, metadata on screen; screener file and metadata spreadsheet to download. |
| **After licensing** | The above, plus the **master**, so they can put the film on their platform. |

Nothing about the second state gates the first. The buyer watches the screener the day the
link arrives.

This replaces the small player card a `screener_view` portal link opens today.

### Explicitly out of scope

- **A public catalog.** An unauthenticated, browsable, Apple-TV/IMDb-style catalogue was
  discussed and deliberately deferred. `CLAUDE.md` puts anything public-facing on the
  do-not-build list and places the public property in `globalcontent-web` (separate repo,
  Tier 2). This app is Tier 3 — contracts, PII, revenue data — and every RLS assumption in it
  begins with "there is a session." If built, it belongs in `globalcontent-web` reading a
  curated published-only feed, and needs its own spec.
- **A designed PDF sales one-sheet.** Considered, deferred.
- **Changes to GC's own vendor delivery flow.** `master_download` links and GC's in-app
  review are untouched.

---

## 2. Decisions taken

| Question | Decision |
| --- | --- |
| Audience | The buyer, across evaluation and post-licence collection. |
| Link scope | **One link per buyer**, not per title. |
| Gating | Fully gated. Email required, OTP code required. Company and name optional. |
| Branding | GC-branded. The buyer knows they are visiting Global Content. |
| Register | Equal weight: viewing and information. Utility meets film aesthetic. |
| Downloads at pitch | Screener file and metadata spreadsheet — **screener file only once the title has a real dedicated screener asset (`screener_source = 'dedicated'`); see the amendment below.** |
| Downloads after licence | Master added. |
| Spreadsheet format | XLSX. |
| Screener download gate | Title past GC approval **AND `screener_source = 'dedicated'`** — see the amendment below. |
| Master download gate | An active rights grant and delivery **for this recipient**, checked in the database. |
| Metadata fields | Keep both `title` and `alternate_title`. |

### Amendment, post-ship (2026-08-06) — the screener download, and on a buyer link the watch itself, additionally require a dedicated screener asset

**As shipped, this is stricter than the table above originally stated, in two stages.** §9's
dependency #3 ("screener proxy — not a hard blocker") was wrong: it is a hard blocker for the
*download* button, and `screener_source` defaults to `'master'` on every title today, so **no
title has a downloadable screener until GC uploads a dedicated one and flips the setting.**

Why: on the `'master'` default, "the screener" is the master file itself, byte-for-byte
(`src/lib/assets.ts`, `screenerKindFor`'s own comment). A one-click **download** hands over a
durable, unwatermarked bearer file to whoever holds the buyer link — bypassing the licence gate
the master route exists to enforce.

The first cut of this fix (above) reasoned that a **watch** only ever streams it, so gating
watch the same way wasn't necessary. That reasoning held for GC's own operational links but not
for a buyer link: `20260806000200` opened link-minting to every client account_owner/
delivery_ops, so a browser `<video>` stream and a one-click download of the same master-sourced
bytes now differ only in how many clicks it takes an external recipient to walk off with an
unwatermarked deliverable — a `<video src>` is a directly-copyable signed URL, not a
copy-protected format. Commit `5892805` closed that gap. **The rule that shipped is:**

- **Watch, on a buyer link** (`portal_links.recipient_name` non-null — the discriminator
  between a client-minted link and GC's own) — gated on approval **AND**
  `screener_source = 'dedicated'`, same as download
  (`src/lib/buyer-page.ts`, `buyerActionsFor.canWatchScreener`; enforced again, independently,
  in `/api/portal/screener/route.ts` since the page's gate only decides what renders, not what
  the stream route will serve).
- **Watch, on GC's own unnamed operational link** — gated on approval only, unchanged. This
  risk predates this branch — GC's own reviewers and vendor screeners have always had this
  access — and is GC's own workflow to carry; breaking it as collateral damage of the buyer-link
  fix would not be a fix, it would be scope creep with a different name.
- **Download, on any link** — gated on approval **AND** `screener_source = 'dedicated'`
  (`src/lib/buyer-page.ts`, `buyerActionsFor.canDownloadScreener`). Absent that, the button does
  not render; the page shows a notice that a viewable screener isn't available for the title
  rather than a dead or 403'ing button.

This makes §9's "not a hard blocker" wrong as written; it has been promoted to a prerequisite
below rather than left standing as a doc that disagrees with the code.

### Why one link per buyer

A title-scoped link cannot safely offer the master. If the page asked only "is this title
licensed," then the moment Tubi signed, **every other prospect still holding a link to that
title could download the master** — the page has no way to tell them apart. Binding the link
to a named recipient turns the question into "does *this* buyer have a live licence," which is
answerable precisely and in the database.

It also earns something the client wants regardless: per-viewer engagement already exists
(`screener_view_events` — watched percentage, completion, replays) but today cannot be
attributed to a named buyer. One link per buyer makes "Tubi watched 40 minutes and came back
twice; Roku never opened it" a real report.

### Accepted tradeoff — the screener download is untraceable

There is no watermarking, transcoding or DRM anywhere in this system by design
(`docs/domain-spec.md` §12). A downloaded screener is an untraceable copy. Raised twice during
design and accepted: buyers need it. The mitigation is provenance, not prevention — see §6.

---

## 3. Architecture

No new route and no new link purpose. `/portal/[token]` already resolves the link, renders an
identical card for invalid/expired/revoked (never leaking which), and hands off to
`PortalFlow`, which owns the identity → code → ready state machine. **Only the `ready` branch
for `screener_view` changes.**

| Piece | Change |
| --- | --- |
| `portal_links` | Gains a recipient: nullable `vendor_id` plus a display name. |
| `create_screener_link` | Takes the recipient. Revoke scope changes — see §7. |
| `src/app/portal/[token]/page.tsx` | Extend the existing `Promise.all` to load trailer, poster, banner, full metadata, and the recipient's licence state. |
| `portal-flow.tsx` | `ready.mode === "screener"` renders the new page. |
| `TitlePage` component (new) | The buyer-facing surface. |
| `POST /api/portal/screener-download` (new) | Signed download URL for the screener. |
| `POST /api/portal/metadata-export` (new) | Streams the XLSX. |
| `BuyerShareControl` | One button becomes a short form: pick the buyer, get a link. |

Both new routes sit behind the same portal session cookie as every existing portal route and
re-resolve the session server-side. **No signed URL is ever issued from anything the browser
supplied.**

### The recipient

`vendors` is GC-managed and already carries `name`, `active` and `export_format_spec`.
`deliveries` links `title_id → vendor_id → grant_id → territory` with a status. So:

- The link stores `vendor_id` (nullable) and a display name.
- **Master appears** when `vendor_id` is set *and* an active grant and delivery exist for that
  `(title, vendor)` — the same rule-12 check `portal_resolve_download` already performs, not a
  new one.
- A client pitching someone not yet in GC's vendor list still gets a working page: display
  name only, screener and metadata work, master never appears. That is correct — delivery is
  manual and GC-run, so a master path necessarily implies GC has set the vendor up.

### Why not a new link purpose

A third purpose (`title_showcase`) and per-link capability flags were both considered. Both
add schema, a second creation path and a parallel viewing surface, to express differences
better stated as rules about state: **screener download once the title is approved; master
once this recipient's licence is live.** The first reuses `isPostApprovalTitleStatus()`; the
second reuses the existing grant check.

An earlier draft keyed behaviour off `is_gc_staff(created_by)`. Rejected: behaviour riding on
a fact invisible at the call site is clever on the day and confusing forever.

---

## 4. The page

Three registers, paired rather than stacked.

**Layout principle.** Viewing and information carry equal weight. At desktop width they sit
**side by side**, so neither reads as an afterthought — the metadata is not a footnote to the
trailer, and the trailer is not decoration on a data page. Below a breakpoint it collapses to
one column, viewing first. Exact visual treatment is for the design pass; this principle binds
it.

**Film.** Banner artwork as hero, poster alongside, title, and one line of key facts — year,
runtime, genre, rating.

**Viewing.** Trailer inline, not behind a click and not autoplaying. Screener plays in place.

**Information.** A dense two-column grid — label left, value right — hairline rules,
consistent row rhythm, tabular numerals so figures align, small-caps labels. It should read as
a well-set spec sheet, not facts sprinkled on a web page. Fields come from `METADATA_FIELDS`
(`src/lib/metadata.ts`), the canonical registry driving both the form and the validator, so a
field added to intake appears here without further work. **Empty values are omitted, not
blanked** — a half-filled sheet reads as neglect.

**Actions.** Prominent: **Watch screener**, **Download**. After licensing, the master joins
them, visibly distinct from the screener so nobody ingests the wrong file.

**GC frame.** Header mark, restrained footer. Present, not loud.

---

## 5. Metadata export

### One engine, not two

`CLAUDE.md` requires a single mapping engine for intake and export. It already exists:
`src/lib/export-spec.ts` (the `ExportFormatSpec` schema, column sources, transforms) and
`src/lib/export-engine.ts` (`buildExportRows`, XLSX via `exceljs`). `vendors.export_format_spec`
with a `STANDARD_EXPORT_TEMPLATE` fallback is already the design — precisely the "some
companies have a template we must follow, others use ours" requirement.

**The buyer export is a template for that engine, not a new exporter.** `exceljs` is already a
dependency, so XLSX carries no new cost.

**Because the link names the recipient, the export can use that recipient's own template.**
When the buyer is a vendor with an `export_format_spec`, their sheet comes out in their
required shape; otherwise it uses GC's standard template. No extra mechanism — this falls out
of binding the link to a vendor.

### Buyer template

`STANDARD_EXPORT_TEMPLATE` minus the **Offer** column. Offer is built from a title's
deliveries to a specific endpoint; at pitch there is none, and showing rights granted
elsewhere would be actively wrong.

### Prerequisite — a `title` column source

`ExportFormatSpec`'s column sources are `field` (a `METADATA_FIELDS` key), `catalog_id`,
`offer` and `static`. **None can emit the film's name**, which lives on `titles.title`, not in
metadata. `STANDARD_EXPORT_TEMPLATE` therefore maps its "Title" column to `alternate_title` —
an *optional* field most titles will not have — so that column is blank for nearly every title
today.

This is a pre-existing defect affecting vendor exports too. A buyer sheet whose most important
column is empty is not shippable, so **adding `{ kind: "title" }` to the source union is a
prerequisite.** Shared, tested file; do it deliberately, with its own tests.

`alternate_title` **stays** as a field — a film often carries different titles by territory.
The template stops using it *as* the title and gains a separate Alternate Title column.

### Filename convention

```
{catalog_id}_{title-slug}_{YYYY-MM-DD}_{recipient}.xlsx

GC00417_monarch-legacy-of-monsters_2026-08-06_tubi.xlsx
GC00417_monarch-legacy-of-monsters_2026-08-06_global_content.xlsx
```

- **Catalog ID first** — a folder of these groups by title; sorting by name sorts by catalogue.
- **Title slug** — findable by a human without a lookup.
- **Date** — metadata is a snapshot. Two versions six weeks apart must be distinguishable or
  someone ingests the stale one.
- **Recipient last** — the named buyer, or `global_content` when none. This token also names
  **which template the file follows**, which is how the official exports are told apart at a
  glance.

**Sanitisation is required.** The recipient and title segments flow into both the filename and
a `Content-Disposition` header — a header-injection path if passed through raw. Both are
slugged: lowercase, ASCII alphanumerics and hyphens only, runs collapsed, capped at 60
characters; empty or unusable input falls back to `global_content`. Naming the recipient at
creation means this value now originates from an authenticated client user rather than an
anonymous visitor, which lowers the risk but does not remove the requirement.

---

## 6. Failure behaviour

| Case | Behaviour |
| --- | --- |
| Screener still archiving | Existing `resolveOrRestore` gate returns "preparing"; the page says so rather than issuing a URL that 403s. Rare once the screener proxy exists. |
| Master archived (post-licence) | Same gate. Pre-warming at delivery creation is a separate improvement, noted in §8. |
| No screener uploaded | Page renders; watch and screener download absent; trailer and metadata work. |
| No trailer | Viewing side shows the screener only. |
| Missing metadata fields | Omitted, not blanked. |
| Title not yet approved | Everything works except watching and the screener download. |
| **Title approved, `screener_source = 'master'` (today's default on every title)** | **On a buyer link (named recipient): neither watch nor download is offered — the page shows a notice that a viewable screener hasn't been provided yet, in place of the whole viewing surface. On GC's own unnamed operational link: watch still works (streams the master); the screener DOWNLOAD button still does not render. A dedicated screener asset is the prerequisite for both, on a buyer link. See the §2 amendment.** |
| Recipient has no licence | Master absent. This is the normal pitch state, not an error. |
| Recipient not a known vendor | Screener and metadata work; master never appears. |
| Missing poster or banner | Layout falls back rather than breaking. |

A partial page beats an error page in every one of these.

### Provenance

Every watch and every download writes a `portal_access_events` row — verified email, name,
company, event type, timestamp — as `master_download` already does. A migration comment
(`20260726000800`) records the deliberate choice to keep portal events there rather than in
`audit_log`: it is purpose-built and org-reachable. This is the only mitigation available for
the untraceable-copy tradeoff in §2, which makes it load-bearing rather than routine.

---

## 7. Consequence for `20260806000200`

The migration written earlier today enforces **one active screener link per title, per side**
(client-authored vs GC-authored), so that a client reset cannot revoke GC's outstanding vendor
link.

**One link per buyer breaks that.** A client pitching a title to five buyers needs five live
links for the same title; the current revoke would destroy four of them on creation.

The revoke scope must narrow from `(title, side)` to `(title, recipient, side)`. Creating a
second link for Tubi still resets Tubi's — which is the desired "replace the link I sent" —
while leaving Roku's untouched.

If `20260806000200` has not yet been applied when this work starts, fold the change into it
rather than shipping a fix on top.

---

## 8. Testing

| Layer | Coverage |
| --- | --- |
| Vitest | Which actions a given (title state, licence state) offers; metadata rendering; buyer template column set; filename construction **including hostile input** — path separators, control characters, CRLF, over-length, empty. |
| Vitest | `{ kind: "title" }` source resolution, alongside existing export-spec tests. |
| pgTAP | Recipient-scoped revoke: a second buyer's link does not revoke the first. Master gating: no grant → no master; grant for a *different* vendor → no master. |
| Manual | Visual layer and full buyer walkthrough, both states. |

The pgTAP master-gating cases are the security-critical ones — a wrong answer there hands the
crown-jewel file to the wrong party. Filename sanitisation tests are likewise non-negotiable:
untrusted input reaching a response header.

---

## 9. Dependencies and sequencing

1. **`{ kind: "title" }` export source** — prerequisite. Shared file, own tests.
2. **Recipient on `portal_links`** plus the narrowed revoke scope (§7).
3. **Screener proxy (option B)** — **prerequisite for the screener DOWNLOAD always, and for the
   WATCH itself on a buyer link.** Originally written as "not a hard blocker"; that was wrong as
   shipped, and wrong twice over. On the `'master'` default, a downloadable screener would hand
   over the unwatermarked master byte-for-byte (see the §2 amendment) —
   `buyerActionsFor.canDownloadScreener` therefore refuses until `screener_source = 'dedicated'`
   and a real screener asset exists. Watching was originally left open regardless (streams the
   master; no different from any other pitch view) — but for a **buyer** link specifically, a
   stream and a download of the same master-sourced bytes are the same exposure with different
   click counts, so `5892805` closed that too: `canWatchScreener` now refuses a buyer link the
   same way `canDownloadScreener` does. GC's own unnamed operational links are unaffected —
   that exposure predates this branch. Practically, this makes the screener proxy a
   prerequisite for the buyer page being useful **at all**, not merely for the download: until
   a title has a dedicated screener asset, a buyer link to it renders a poster, a synopsis, and
   a metadata download with no way to watch anything — the pitch itself doesn't work yet, only
   GC's own internal review of the same title does. Approved separately on 2026-08-06; requires
   a scoped amendment to `docs/domain-spec.md` §12.
4. **This page.**

## 10. Open items

- Exact visual treatment — design pass, bound by §4's equal-weight principle.
- Official vendor export templates, when supplied, become `export_format_spec` records. No
  engine change expected.
- **Pre-warming Glacier restores at delivery creation**, so a post-licence master is warm
  before the buyer opens the link rather than after a 3–5 hour wait. Discussed 2026-08-06,
  agreed in principle, not specced.
