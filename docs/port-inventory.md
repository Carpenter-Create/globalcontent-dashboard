# Port inventory: watershedportal → Global Content distribution dashboard

> Survey only — no code was copied. Classifications: **AS-IS** (infra, no domain/brand coupling) · **EDITS** (right shape, wrong specifics) · **NO** (Watershed domain/brand/palette/copy/business logic) · **MISSING** (dashboard needs it; watershedportal has no equivalent).
> Scope note: watershedportal is mid-migration. `packages/db/` (Aurora, Drizzle) is canonical; `supabase/migrations/` is Auth-only legacy. Tables below are the canonical Aurora schema unless marked *legacy*.
>
> **Re-checked against `CLAUDE.md`'s porting rule and `docs/domain-spec.md`** (this pass). Rows whose classification changed from the original survey are logged at the end under **Reclassifications** and marked ⚑ inline. Governing rule: *"In doubt about a table? It's domain. About a pattern? Probably fine."* + *"GC has no multi-party splits — no works, writers, publishers, splits, shares, or payee concepts may cross."*

## The three critical answers

**1. Large media uploads — multipart/resumable/50–200GB, or documents only?**
Neither extreme. watershedportal is **not** document-only: it has a real heavy-media vault — S3 direct-to-bucket via presigned URLs, **Object Lock (WORM)**, dedicated KMS CMK, **Intelligent-Tiering → Glacier/Deep Archive**, cross-region replication, **CloudFront signed-URL delivery**, and IAM that even grants `s3:AbortMultipartUpload`/`ListMultipartUploadParts` (`infra/terraform/modules/media-vault`, `media-iam`). It moves audio masters (WAV/FLAC/ADM-BWF, hundreds of MB) and defines a `video`/`motion_art` asset kind. **However, the application upload code presigns a single `PutObjectCommand` (15-min expiry) and does one `fetch(url,{method:'PUT',body:file})`** (`apps/web/components/releases/media-upload.ts`, `packages/edge-functions/src/media-upload/handler.ts`). Grep for `CreateMultipartUpload`/`UploadPartCommand`/`partNumber`/`resumable` across `apps/web`+`packages` returns nothing. S3 caps a single PUT at ~5GB, so **50–200GB masters are not wired end-to-end.**
→ **Verdict:** the presign → PUT → S3-event-finalize → CloudFront-sign backbone + `assets`/`asset_renditions` tables + finalize worker = **EDITS** (strong reusable spine). The **multipart/resumable large-video layer + Glacier-restore `restoring` state = MISSING** (net-new; the single largest v1 build item, exactly as the domain-spec predicts).

**2. Does RLS enforce roles, or only tenancy?**
**Both**, unified in one SECURITY DEFINER resolver `public.member_can(user, account, capability)` (`supabase/migrations/20260614190100_member_can_resolver.sql`): staff roles (`is_platform_admin`/`is_company_user`) **bypass tenancy** and see everything; client members are **tenancy-scoped** by `client_account_id` **and** **role→capability gated** (`owner` > `team` > `viewer`; e.g. `viewer` may `view` but not `contribute`, only `owner` may `manage_team`/`manage_settings`). Capabilities were formerly per-member boolean columns, later dropped for pure role-derivation (`20260614190200_pure_role_enforcement.sql`). A parallel older `portal_role`/`has_role` RBAC exists but is vestigial.
→ **Verdict:** role-based, not tenancy-only. The resolver pattern (single DB function, role→capability map, staff bypass) is exactly the shape the dashboard's 5-client-role + `gc_*` mirror model needs = **EDITS**.

**3. Does the AI agent run with the user's JWT or the service-role key?**
The **canonical/forward agent runs under the user's JWT + RLS.** The chat route validates `supabase.auth.getUser()` and builds `ctx={userId,role:'authenticated'}`; every tool query runs inside `withUser(ctx, …)` which does `set local role authenticated` + sets `app.user_id`/`app.role` GUCs transaction-locally (`apps/web/app/api/ai-chat/route.ts`, `packages/db/src/ai-tools.ts`, `client.ts`). **Writes never touch service-role**: the agent uses a dedicated, powerless `agent` login role (`withAgent`, `AGENT_DATABASE_URL`) that can only insert/refine its own **proposals**; humans commit via SECURITY DEFINER `approve_*` RPCs — the "agent wall" is enforced in the database. **Service-role appears only in the legacy Supabase Deno edge functions** (`support-message`, `analyze-message`, `parse-voice`) which authenticate the user's JWT but then query with `SUPABASE_SERVICE_ROLE_KEY` (bypassing RLS); `parse-lyrics` is the clean one (anon key + caller JWT).
→ **Verdict:** forward path = **user-JWT/RLS** and matches the dashboard's hard rule ("Globee runs with the user's JWT — never service-role") = **EDITS** (reuse `withUser`/`withAgent`/proposal-wall pattern). The legacy service-role edge-function pattern = **NO**.

## Secrets / credentials flag (source repo — nothing copied)
| Location | Finding | Severity |
|---|---|---|
| `.github/workflows/ci.yml:13` | Real **Supabase anon JWT** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) committed; present **history-wide** (since commit `b723aec`); decodes to expose project ref. | Low–Mod (anon is publishable, but a live token + project ref; rotate if project meant private) |
| `docs/superpowers/plans/2026-06-20-agentic-foundation-proposals-spine.md:568` | Plaintext **dev DB password** literal in `AGENT_DATABASE_URL=…` (host is a placeholder); **history-wide**. | Low (dev, placeholder host; scrub/rotate) |
| `apps/web/.env.local` | Contains a **live `ANTHROPIC_API_KEY` (`sk-ant-…`)**. Correctly **gitignored, never committed / not in history**. Not inspected/copied. | Info (confirm ignore holds; rotate if ever exposed) |
| `.env.aws` | **Committed and NOT gitignored**, but contains **no literal secrets** (passwords fetched from AWS Secrets Manager at runtime); discloses dev Aurora hostname only. | Info (consider gitignoring/renaming for hygiene) |
| Negative | No `sk-ant`/`sk-`/`AKIA`/`-----BEGIN PRIVATE KEY-----`/`service_role` JWT committed anywhere in tree or history. | — |

---

## A. Monorepo, build & config
| Path | Class | Reason |
|---|---|---|
| root `package.json`, `pnpm-workspace.yaml`, `turbo.json` | AS-IS | pnpm+turbo workspace plumbing; only `name:"watershed"` changes |
| `packages/config/tsconfig/*`, `apps/web/tsconfig.json` | EDITS | shared TS presets fine; path aliases carry `@watershed/*` names |
| `packages/config/eslint/*`, `apps/web/eslint.config.mjs`, `postcss.config.mjs` | AS-IS | generic lint/postcss |
| `apps/web/package.json` (deps) | EDITS | Next 15.5 / React 18.3 / `@supabase/ssr` / react-query / Sentry / `@aws-sdk` baseline is good; rename scope, drop music libs (`mammoth`, `jspdf`) |
| `apps/web/next.config.mjs` | EDITS | Sentry wrapper + `serverExternalPackages` reusable; the whole `redirects()` block is Watershed route vocabulary |
| `apps/web/middleware.ts` | EDITS | `updateSession` refresh pattern AS-IS; `matcher` route groups are Watershed names |
| `apps/web/.env.example` | EDITS | var scaffold generic; Algolia index names + comments are music-domain |
| `instrumentation*.ts`, `sentry.*.config.ts` | AS-IS | DSN-gated, inert until configured |

> Note: this repo is a **single-package Next.js app — no monorepo, no `packages/`, no workspaces** (`CLAUDE.md` "Platform"). The `pnpm-workspace.yaml`/`turbo.json` plumbing above ports as *concepts*; the multi-package layout itself does not carry over.

## B. Supabase auth & session plumbing
| Path | Class | Reason |
|---|---|---|
| `packages/lib/src/integrations/supabase/client.ts` | AS-IS | textbook `createBrowserClient` |
| `apps/web/lib/supabase/server.ts`, `lib/supabase/middleware.ts` | AS-IS | textbook `@supabase/ssr` server client + `updateSession` |
| `apps/web/app/(auth)/auth/callback/route.ts` | EDITS | magic-link/PKCE exchange AS-IS; strip the Aurora `provisionAuroraUser` mirror call |
| `packages/lib/src/contexts/AuthContext.tsx` | EDITS | session/access-state scaffold reusable; role enums (`platform_role`, `portal_context`, `publishingEnabled/recordsEnabled`) are Watershed |
| `packages/lib/src/lib/permissions.ts` | NO | `hasLicensingModuleAccess` etc. = Watershed role/module logic (keep only the *one-permissions-module* pattern) |
| `apps/web/app/_app/guards.tsx` | EDITS | guard-component pattern reusable; specific checks are domain |
| `useRoleAccess`, `useModuleAccess`, `useUserModuleAccess`, `useClientAccess`, `useHelpAccess`, `useBillingAuthority`, `usePublishingAttention` | NO | all bound to Watershed roles/modules |

## C. Design system & brand — FLAG ALL (Watershed brand pending GC's own accent)
| Path | Class | Reason |
|---|---|---|
| `apps/web/app/styles/watershed-theme.css` | EDITS | token *architecture* (structural greyscale + one accent) matches the house system; swap `--watershed-*` names and drop brand red `#E03C31` |
| `packages/config/tailwind/*` | EDITS | keep type scale + token structure; rename `watershed.*`, drop `brand`/red |
| `apps/web/app/globals.css` (126 KB) | EDITS | reset/scroll infra reusable; strip `@font-face 'Watershed Display'`, brand refs — budget pruning time |
| `packages/lib/src/constants/institutional-copy.ts` | NO | locked Watershed voice + legal name ("© Watershed Rights Management LLC"); keep only the *centralized-copy* idea |
| `public/watershed-emblem.png`, `favicon*`, `og-image.png`, `fonts/watershed-display.ttf`, `WatershedLogo.tsx`, `WatershedMark.tsx` | NO | brand marks/fonts (`robots.txt`, `placeholder.svg` are AS-IS) |
| Product-name strings ("Watershed Portal/Team/Admin/AI") | NO | global find/replace target |
| Watershed **palette/red `#E03C31`**, focus blue `#0071E3` | NO | Watershed brand palette — must not appear in this repo (GC accent is a founder checkpoint; stay on the neutral placeholder) |

## D. UI component kit (the single most reusable asset)
| Path | Class | Reason |
|---|---|---|
| `packages/ui/src/ui/*` (shadcn/Radix: button, input, table, dialog, drawer, sheet, popover, select, tabs, tooltip, badge, card, checkbox, switch, skeleton, sonner, scroll-area, separator, textarea, rich-text-editor, copy-button, page-container, activity-log, correlation-chain, institutional-states, Icon) | AS-IS | brand-neutral primitives (after retheming tokens) |
| `packages/ui/src/platform-ui/*` (PlatformButton/Card/Table/Tabs/Select/Dropdown/Panel/Pagination/StatCard/ListCard/PageLayout/PageHeader/FilterDrawer/SearchInput/EmptyState/RowActions/DetailRow/SettingsCard/Chip/Avatar/Typeahead/DatePicker/InfoTip/Section) | AS-IS | token-driven layout/list/table/form system; brand-neutral |
| `packages/ui/src/styles/tokens.ts` | EDITS | retheme to GC tokens |

## E. App chrome & navigation
| Path | Class | Reason |
|---|---|---|
| `components/chrome/AppShell, UniversalShell, AppHeader, SideNav, AccordionNav, ModuleMobileNav, GlobalSearchDialog, RouteProgress, LoadingGate, UserMenuDropdown, OrganizationSwitcher, TenantSelector, UnsavedChangesGuard, HeaderIconButton, sidebar-context, nav-styles` | EDITS | shells/nav reusable but consume Watershed `moduleNav` + tenant model — rewire |
| `components/edit/*` (EditSheet/Field/SelectSheet/ActionsBar), `components/RedirectTo.tsx` | AS-IS | generic editing/redirect helpers |
| `components/auth/AuthSurface.tsx`, `SignInHelpDialog.tsx`, `components/standalone/*` (access/pending/suspended/check-email/link-expired/unauthorized/invite) | EDITS | shapes reusable; copy is Watershed-institutional |
| `packages/lib/src/config/moduleNav.ts` | NO | full sidebar map (publishing/records/royalties/watershed-ai) — rebuild for film/TV |

## F. Generic lib utilities & hooks
| Path | Class | Reason |
|---|---|---|
| `packages/lib/src/lib/utils.ts` (`cn`) | AS-IS | clsx+tailwind-merge |
| `use-mobile`, `useDebounce`, `use-delayed-loading`, `useScrollReset`, `useScopeTransition`, `useRouteMetadata` | AS-IS | generic UI hooks |
| `contexts/ThemeContext.tsx`, `lib/density.ts`, `config/layout.ts`, `constants/session-timeout.ts` | AS-IS | theme/density/layout/timeout (retheme colors only) |
| `lib/storage.ts` | EDITS | small-image Supabase Storage uploader; `help-articles` bucket + 5MB cap coupling |
| `lib/algolia.ts`, `lib/search/algolia-admin.ts`, `search/catalog-sync.ts` | EDITS | search infra generic; indices/catalog specifics are music |
| `lib/edge/invoke.ts` | EDITS | server-action → private IAM Lambda proxy (forwards JWT) — excellent reusable pattern; `FUNCTIONS` registry names Watershed Lambdas |
| `services/PaymentService.ts`, `StripePaymentService.ts` | EDITS | processor-agnostic abstraction + Stripe impl; some governance coupling in comments |

## G. Domain feature code — DO NOT TRANSFER (keep the *conventions*, not the logic)
| Path | Class | Reason |
|---|---|---|
| `lib/publishing/`, `lib/records/`, `lib/deals/`, `lib/queue/`, `lib/licensing/`, `lib/auditor/`, `lib/dataroom/`, `lib/clients-admin/`, `lib/org-admin/`, `lib/help*/`, `lib/support/`, `lib/notifications/`, `lib/identity/`, `lib/access/`, `lib/assets/` (each `actions.ts` + `use-*.ts`) | NO | Watershed domain server-actions/hooks (reuse the colocated `actions.ts` + `use-X.ts` *convention*) |
| `lib/lyrics.ts`, `lib/reference/{genres,pros,territories-music}.ts`, `lib/mlc/*`, `lib/trolley.ts` | NO | music reference/integrations — **exception:** `lib/trolley.ts` is EDITS (dashboard also uses Trolley for payouts) |
| `components/rights/**`, `components/releases/**`, `components/catalog/**`, `components/licensing/**`, `components/clients/**`, `components/console*/**`, `components/auditor/**`, `components/admin/**`, `components/help/**`, `components/support/**`, `components/queue/**`, `components/messages/**`, `components/watershed-ai/**`, `components/tasks/**`, `components/onboarding/**`, `components/account/**`, `components/settings/**` | NO | publishing/records domain UI (structurally useful as layout reference only) |

## H. API routes / server actions / AI stack
| Path | Class | Reason |
|---|---|---|
| `app/api/ai-chat/route.ts` | EDITS | streaming-Claude scaffold + RLS `withUser` is a strong template; tools/persona/copy are domain |
| `app/api/catalog/events/route.ts` | EDITS | first-party-cookie analytics pattern generic; event types are catalog |
| `app/api/catalog/songs/[songNumber]/sample/route.ts` | EDITS | CloudFront-signing helper reusable; song/demo semantics domain |
| `lib/ai/claude.ts` | EDITS | single Claude provider seam (`api.anthropic.com`); rename constants, redo prompts (use latest model per house rules) |
| `lib/ai/chat-config.ts`, `responder.ts`, `voice.ts` | NO | publishing persona/tools/system-prompts |
| `packages/db/src/agent.ts`, `proposals.ts`, `ai-tools.ts`, `client.ts` (`withUser`/`withAgent` + proposal wall) | EDITS | the user-JWT-read + walled-`agent`-write architecture is exactly the dashboard's required posture — reuse the pattern, re-point tools |

## I. Media / upload pipeline, edge functions & infra
| Path | Class | Reason |
|---|---|---|
| `apps/web/components/releases/media-upload.ts` | EDITS | presign→single-PUT→poll flow reusable shape; **single PUT only — must add multipart/resumable** |
| `packages/edge-functions/src/media-upload/handler.ts` | EDITS | `create_pending_asset` RPC + presign PUT; extend to `CreateMultipartUpload`+part presign |
| `packages/edge-functions/src/media-finalize/handler.ts` | EDITS | S3-event finalize (checksum/dedup/WORM) reusable; header-metadata sniffing is audio/doc-only (no video containers) |
| `packages/edge-functions/src/media-sign/handler.ts`, `supabase/functions/_shared/aws-media.ts` | EDITS | CloudFront signed-URL delivery — reusable media plumbing |
| `packages/asset-naming/src/index.ts` | NO | DDEX/DSP naming rules are music (keep the *single-naming-module* pattern) |
| `infra/terraform/modules/media-vault`, `media-iam`, `aurora-postgres` | EDITS | S3 Object-Lock/KMS/Glacier/CloudFront + Aurora modules are a strong IaC base; rename, and the app must actually use the multipart IAM perms already granted |
| Supabase Deno fns: `api-gateway`, `access-help`, `send-auth-email`, `send-support-email`, `support-form`, `support-webhook`, `_shared/{resend,email,inbound,event-email}` | EDITS | generic gateway/email/webhook plumbing |
| Supabase Deno fns: `client-invites`, `send-submission-confirmation`, `support-message`, `analyze-message`, `parse-voice`, `parse-lyrics`, `trolley` | NO | domain/AI (service-role DB access on several — do not carry that pattern); `trolley` is EDITS |
| AWS Lambdas: `accept-invite`, `generate-disclosure-export`, `_shared/{auth,http,secrets,media-meta}` | EDITS | `accept-invite`/shared-auth reusable; disclosure-export is auditor-domain (NO); `media-meta` needs video support |

## J. Database tables — every table classified individually (canonical Aurora schema)

### Identity / tenancy / access
| Table | Class | Reason |
|---|---|---|
| `users` | EDITS | Aurora mirror of `auth.users` — reusable identity sync pattern |
| `user_profiles` | EDITS | person + `platform_role`/status/prefs — maps to GC user profile |
| `user_preferences` | EDITS | per-user UI/notification prefs |
| `tenants` | EDITS | older org model → maps to `organizations` (redundant with `client_accounts`; pick one org model, don't port both) |
| `tenant_memberships` | EDITS | user↔org+role+status → maps to GC org membership |
| `tenant_ui_policies` | EDITS | per-org UI policy config |
| `module_access` | NO | Watershed module-grant model (dashboard uses role→capability, not module grants) |
| `platform_user_capabilities` | EDITS | per-user platform capability flags → GC `gc_*` staff capability seam |
| `invitations` | EDITS | generic invite table |
| `access_requests` | EDITS | request platform/module access |
| `client_accounts` | EDITS | **the live client-org model** (`publishing_enabled`/`records_enabled` are domain flags; Trolley fields reusable) → GC `organizations` |
| `client_account_members` | EDITS | user↔account+role (`owner`/`team`/`viewer`) → GC 5-role membership |
| `client_account_member_writers` | NO | member↔writer-identity link (music) |
| `client_account_invitations` | EDITS | invite to a client account |
| `client_invitations` | NO | parallel/older invitation table (vestigial) |
| `client_ipi_numbers` | NO | IPI (music-rights identifiers) |
| `company_users` | EDITS | Watershed staff identities → GC-side staff |

### Publishing / rights / catalog — all NO (music domain)
| Table | Class | Reason |
|---|---|---|
| `songs` | NO | musical work (ISWC) |
| `song_versions` | NO | song version history |
| `song_visibility_overrides` | NO | per-client song visibility |
| `song_writers` | NO | writer share on a song |
| `writers` | NO | writer party master (IPI/PRO) |
| `publishers` | NO | publisher party master |
| `deals` | NO | publishing deal (writer_share/territory) |
| `deal_publishers` | NO | publishers on a deal |
| `deal_territories` | NO | deal territory rows |
| `watershed_entities` | NO | Watershed PRO/administrator entities |
| `interested_parties` | NO | generic music party model |
| `interested_party_ipi_numbers` | NO | IPI for parties |
| `song_interested_parties` | NO | party↔song attach |
| `pro_organizations` | NO | reference: PROs (ASCAP/BMI…) |
| `territories` | ⚑ **NO** | **Changed EDITS→NO.** A PRO/publishing territory table likely carries CISAC/TIS territory groupings, not plain ISO. The spec stores territories as **resolved ISO 3166-1 alpha-2 codes inline on `rights_grants.territories`** (§9) — GC needs an ISO validation list seeded fresh, not this table. "In doubt about a table? It's domain." Keep the *pattern* (resolve to explicit ISO codes), not the row. |
| `song_ownership`, `song_publishers` | NO | already dropped (0029/0032); publishing now derived |

### Records / releases (masters) — all NO (music domain)
| Table | Class | Reason |
|---|---|---|
| `recordings` | NO | sound recording (ISRC) |
| `recording_artists` | NO | recording↔artist |
| `recording_credits` | NO | credited contributors |
| `artists` | NO | artist master |
| `releases` | NO | release/product |
| `release_artists` | NO | release↔artist |
| `release_tracks` | NO | tracklist |
| `release_products` | NO | editions/UPCs |
| `resource_links` | EDITS | generic external-link attach pattern (repoint FK targets; nothing music-specific in the shape) |

### Submission queues — NO (music intake), pattern noted
| Table | Class | Reason |
|---|---|---|
| `song_queue` | NO | client song submissions to review (the intake→review→approve *pattern* maps to GC title/delivery review) |
| `song_queue_messages` | NO | messages on a queued submission |
| `party_queue` | NO | writer/publisher submissions |
| `voice_transcripts` | NO | voice-intake transcripts |

### Agentic AI proposals (the "agent wall") — EDITS (reuse for Globee)
| Table | Class | Reason |
|---|---|---|
| `proposals` | EDITS | AI-proposed changes (draft-only; humans commit) — exactly GC's Globee-drafts-you-approve model (§20) |
| `proposal_messages` | EDITS | thread on a proposal |
| `proposal_decisions` | EDITS | approve/reject audit |

### AI / support / help
| Table | Class | Reason |
|---|---|---|
| `ai_conversations` | EDITS | stored AI chats → Ask Globee history (Globee deferred; seam only) |
| `ai_messages` | EDITS | AI turns |
| `ai_intake_drafts` | NO | AI song-intake drafts (music) |
| `ai_agent_config` | EDITS | agent config |
| `system_prompts` | EDITS | versioned LLM prompts |
| `support_knowledge_base` | EDITS | KB feeding support agent |
| `support_tickets` | EDITS | tickets → GC Support (push) channel |
| `ticket_messages` | EDITS | ticket messages |
| `support_ticket_reads` | EDITS | per-user read markers |
| `help_articles` | EDITS | KB articles (tsvector) |
| `help_categories` | EDITS | help taxonomy |
| `help_audiences` | EDITS | audience segments |
| `help_article_audiences` | EDITS | article↔audience |
| `help_category_audiences` | EDITS | category↔audience |

### Internal workspace (in-house Asana) — NO (out of dashboard scope)
| Table | Class | Reason |
|---|---|---|
| `teams`, `team_members`, `projects`, `project_members`, `tasks`, `workflow_templates`, `workflow_steps`, `automations`, `task_automation_runs` | NO | generic PM tool the dashboard spec does not call for |

### Assets / media vault — EDITS (extend for large video)
| Table | Class | Reason |
|---|---|---|
| `assets` | EDITS | S3-keyed media registry + status lifecycle → GC asset pipeline (S3 key not URL) |
| `asset_renditions` | EDITS | derived renditions (waveforms/thumbs/streams) → captions/artwork/proxies |

### Licensing & billing
| Table | Class | Reason |
|---|---|---|
| `licensing_requests` | NO | per-work license request (music licensing ≠ GC distribution) |
| `licensing_agreements` | NO | executed music license |
| `licensing_access_requests` | NO | request the licensing *module* |
| `invoices` | EDITS | integer-cents invoices → GC fee-schedule/invoicing (Stripe money-in) |
| `invoice_line_items` | EDITS | line items |
| `payments` | EDITS | payments (Stripe money-in) |
| `refunds` | EDITS | refunds |
| `contracts` | EDITS | contract records → GC distribution agreements |
| `contract_associations` | EDITS | link contracts to entities — generic join *pattern*; its FK targets in Watershed are music entities, so repoint, don't inherit |
| `portal_agreements` | EDITS | client-facing agreements (document-surfacing layer, not the royalty math) |
| `portal_documents` | EDITS | client-facing documents |
| `portal_statements` | ⚑ **NO** | **Changed EDITS→NO.** A publishing statement is built on the per-writer/per-publisher **shares/splits** ontology the spec forbids (§14 "No multi-party splits exist… take nothing from royalogic's splits engine"). GC's revenue statement is single-vendor, no-splits, and **net-new/deferred** (see §K MISSING #9, spec §23). Porting this table risks dragging share-breakdown structure across. Keep the *client-facing-statement surfacing pattern* for the deferred build; port no schema. |

### Governance / audit / ops
| Table | Class | Reason |
|---|---|---|
| `audit_logs` | EDITS | central to GC provenance/audit spine (append-only; UPDATE/DELETE revoked) |
| `access_logs` | EDITS | access event log (needed for view-as-client audit, §22) |
| `api_tokens` | EDITS | API token model (generic; not in v1 scope — carry only if/when a public API lands) |
| `api_access_logs` | EDITS | API access log (same caveat) |
| `notifications` | EDITS | user notifications (v1 dependency — in-app + email) |
| `notification_archive` | EDITS | archived notifications |
| `escalation_events` | EDITS | escalation events |
| `escalation_rules` | EDITS | escalation rules |
| `catalog_events` | EDITS | change event stream → GC title/delivery events |
| `catalog_health_snapshots` | EDITS | data-quality snapshots → GC health score (derived number — must carry lineage) |
| `search_index` | EDITS | FTS index |
| `search_query_log` | EDITS | query log |
| `backup_manifests` | EDITS | backup manifests |
| `recovery_events` | EDITS | DR event log |

### Auditor data room — NO (Watershed rights-diligence)
| Table | Class | Reason |
|---|---|---|
| `data_room_exports` | NO | auditor export jobs |
| `data_room_access_log` | NO | data-room access log |
| `disclosure_exports` | NO | diligence disclosure packages |

### Legacy-only tables (exist only in `supabase/migrations`, vestigial)
`profiles`, `user_roles`, `membership_roles`, `context_permissions`, `works`, `statements`, `splits`, `registrations`, `documents`, `generated_documents`, `client_documents`, `licenses`, `license_types`, `license_packages`, `license_requests`, `internal_notes`, `tenant_notes`, `status_history`, `data_catalog_tables`, `data_catalog_columns`, `contact_submissions`, `articles`, `categories`, `messages`, `chat_*`, `widget_settings`, `audit_log` — **NO** (Auth-era leftovers, not carried into Aurora; do not port). Note `works`/`statements`/`splits` here are the splits ontology the spec bars outright.

### Views / enums / functions
- **Views** — all `public_*` derived catalog reads (`public_songs`, `public_recordings`, `public_releases`, `public_artists`, `public_help_*`, etc.): **NO** (music-catalog projections). The *pattern* of a public/anon read-view layer is reusable.
- **Enums** (44: `app_role`, `org_role`, `platform_role`, `portal_context`, `client_kind`, `song_queue_status`, `retention_class`, `sensitivity_tag`, …): identity/access/retention enums = **EDITS** (reshape to GC roles + retention classes); song/deal/publishing/records enums = **NO**.
- **RPC / SECURITY DEFINER functions** (~90): access resolvers (`member_can`, `is_platform_admin`, `has_module_access`, tenancy checks) = **EDITS** (reuse resolver pattern for GC roles); mutation RPCs (`submit_song_to_queue`, `approve_song_intake`, `submit_release`, …) = **NO** (music mutations) except **`create_pending_asset`/`finalize_asset`/`asset_by_key`/`find_ready_duplicate` = EDITS** (asset pipeline) and **`accept_invitation`, `log_audit_event`, `log_access_event`, `create_notification`, `resolve_notification` = EDITS** (generic ops); the mutations-through-SECURITY-DEFINER-RPC discipline itself = **EDITS** (adopt wholesale).

## K. MISSING — dashboard needs, watershedportal has no equivalent
1. **Multipart / resumable 50–200GB upload layer** — `CreateMultipartUpload` + presigned part URLs + resume/checksum. watershedportal presigns a single PUT only. *(Largest v1 build item.)*
2. **Glacier restore workflow + delivery `restoring` state** — masters→Glacier Flexible at 90d; 5–12h bulk restore modeled as a first-class delivery state.
3. **`rights_grants` as a first-class, effective-dated, per-title entity** — rights type (avod/svod/tvod/fast), territory mode (world/include/exclude) → resolved ISO codes, windows/holdbacks; **delivery gated by an active grant in the DB**; "grants expand, never contract."
4. **Vendors + delivery matrix** — `vendors` (`export_format_spec` jsonb, portal-upload vs templated-email modes) and `deliveries` as `title × vendor × territory`, status set by a person.
5. **Bidirectional metadata mapping engine** — client sheet→canonical (intake) and canonical→vendor (export) as one engine; "AI maps, the zod validator decides" (mapping output applied deterministically).
6. **Findings store + health score + attention queue** — validator findings (v1) vs AI findings (deferred) kept labeled apart. *(`catalog_health_snapshots` is only a partial seed.)*
7. **Contract lifecycle** — e-sign execution, `contract_review` gate, tier/term state machine (FREE/MID/PRO), fee-schedule SKUs (downgrade/takedown/rights_change/upgrade_differential), payment-lapse cron; `contract_terms` effective-dated with snapshotted `revenue_share_rate_bp`.
8. **Provenance spine** — `source_documents`, immutable `source_records`, derived tables carrying `source_refs` + `logic_version` + `derived_at`, append-only `audit_log`. watershedportal has `audit_logs` + some derivation RPCs but not the full lineage spine.
9. **Revenue pro-ration engine** (deferred) — single-vendor basis, accounting periods, N-slice pro-ration, integer cents. No distribution-revenue equivalent. **`portal_statements` is NOT a seed for this — see §J reclassification.**
10. **Separation-of-duties seam + audited "view-as-client" backdoor** — GC-staff impersonation that must be loudly audit-logged. No equivalent.
11. **`org_role` model (5 client roles + `gc_*` mirror with inverted scope) shipped in the first migration** — watershedportal's `owner/team/viewer` is a smaller shape; the resolver pattern transfers, the role set does not.

> Note: **Trolley payouts are NOT missing** — watershedportal has `lib/trolley.ts`, the `trolley` edge function, and Trolley fields on `client_accounts` (= EDITS). Stripe (money-in) is also present (`PaymentService`/`StripePaymentService` = EDITS).

---

## Reclassifications from the pre-rules inventory

The original survey was produced **before** this project's `CLAUDE.md` was loaded, so its classifications did not apply the porting rule (*"In doubt about a table? It's domain. About a pattern? Probably fine"*) or the no-splits/no-payee bar. Re-checked against `CLAUDE.md` and `docs/domain-spec.md`, two rows changed. Both moved toward domain (EDITS→NO); no row was loosened.

| Row | Was | Now | Why it changed |
|---|---|---|---|
| `portal_statements` (§J Licensing & billing) | EDITS | **NO** | Original mapped it to "GC revenue statements." A publishing statement is inherently built on the **per-writer/per-publisher shares/splits** ontology the spec bars (§14; `CLAUDE.md` "GC has no multi-party splits"). GC's statement is single-vendor, no-splits, and **net-new/deferred** (MISSING #9, spec §23 — built fresh against real vendor reports, royalogic's *accounting-period* pattern only, never its splits). Porting the table risks smuggling the share-breakdown shape across. Pattern (client-facing statement surfacing) may inform the later build; schema does not port. |
| `territories` (§J Publishing/rights/catalog) | EDITS | **NO** | Original kept it as a "reusable ISO reference." But this is the lone EDITS in an otherwise all-NO publishing block, and a PRO-context territory table almost certainly carries CISAC/TIS territory groupings rather than plain ISO. The spec stores territories as **resolved ISO 3166-1 alpha-2 codes inline on `rights_grants`** (§9) and mandates no separate ref table — GC seeds an ISO validation list fresh. Under "in doubt → domain," the table is domain; the reusable thing is the *pattern* (resolve labels to explicit ISO codes at grant time). |

**Reviewed and deliberately kept (no change), with caveats noted inline:**
- `contract_associations` (EDITS) — generic contract↔entity **join pattern**; the risk is only in its FK targets (music entities in Watershed), which get repointed on port. "About a pattern? Probably fine."
- `resource_links` (EDITS) — generic external-link attach; nothing music-specific in the shape.
- `tenants` / `tenant_memberships` (EDITS) — sanctioned tenancy plumbing (the most valuable thing watershedportal donates), but redundant with `client_accounts`/`client_account_members`; **pick one org model, don't port both.**
- `api_tokens` / `api_access_logs` (EDITS) — generic, but not in v1 scope; carry only if a public API is actually built.
- `ai_conversations` / `ai_messages` (EDITS) — Ask Globee is deferred; these port as a **seam**, not a v1 build.

## Verification
- Deliverable is a document, not code. Verify by: (1) `docs/port-inventory.md` exists and renders as valid Markdown; (2) every canonical Aurora table appears in exactly one §J row with one classification; (3) the two changed rows carry the ⚑ marker inline and appear in the Reclassifications table with rationale; (4) no Watershed palette value, brand token, or copied source file entered this repo — `grep -ri '#E03C31\|watershed' src/` should return nothing (only this doc mentions them, and it lives in `docs/`).
- No build/test run required; no source files copied; `.claude/settings.json` destructive-ops guard untouched.
