# Evidence Library Platform — Roadmap to the Final Version

This document defines the final Evidence Library product, its subscription website, and the new Coolify project that will run it.

The current Coolify project, deployments, databases, indexes, workers, branches, and hostnames remain untouched. Existing libraries are considered only in the separate post-launch migration program.

## Product direction

Give research organizations a simple way to run fast, accessible, discoverable evidence libraries: author directly, connect Zotero, publish through Crossref or Zenodo, add needed plugins, and use citation-backed AI without managing infrastructure.

### Launch objective

An institution can launch and operate a trustworthy evidence library, with only the plugins it chooses, without manual infrastructure work.

The launch is successful when:

1. A customer completes setup and reaches a working library without an operator editing Coolify or source code.
2. Staff can create a native record in `/admin`, publish it, and find it through normal search.
3. Native and Zotero-linked records use the same revision and indexing path without silent data loss.
4. Every AI citation resolves to a record, and to a page when page data was used.
5. The core and every plugin meet WCAG 2.2 AA.
6. Public pages meet the agreed Core Web Vitals targets at the 75th percentile on mobile and desktop.

Workflow-speed targets will be set after the first user checkpoint rather than guessed in advance.

### Primary users

| User | Main job | Success condition |
|---|---|---|
| Library owner or administrator | Configure and operate one institutional library. | The library stays current without infrastructure work. |
| Researcher or review lead | Create, organize, publish, and retrieve evidence. | Records move from draft to discoverable publication with clear status. |
| NGO or policy analyst | Search and reuse evidence for decisions. | Relevant records, files, exports, and citations are easy to find. |
| Public researcher or reader | Browse, search, save, and follow published work. | Public information is fast, accessible, and understandable. |

## Final architecture

- One existing Coolify server hosts one new Coolify project. Old resources are a strict denylist.
- The subscription platform is a separate, greenfield product in a new codebase. It is not part of the Evidence Library application.
- That codebase produces separate deployables for the public website and customer portal, the control-plane API, and the provisioning and release workers. They share contracts and a platform database without becoming one monolith.
- Each library has one Evidence Library application deployment and its own PostgreSQL database and database role.
- The platform database, PostgreSQL service, Meilisearch, object storage, workers, PostHog, and provisioning services are shared inside the new project. The platform database is separate from every library database.
- Each library receives its own Meilisearch index and key, storage prefix, worker registrations, manifest, credentials, limits, and publication state.
- Every application runs the same immutable image digest. Customer configuration never creates a custom build.
- The control-plane backend owns organizations, libraries, plugins, configuration, manifests, provisioning, usage, billing, and releases. The website and portals are clients of that backend.
- Plugins are the only optional-capability system. There is no separate feature-flag system.
- PostHog is used only for analytics. All PostHog feature-flag and entitlement code is deleted.
- PostgreSQL is canonical. Each committed record change increments a database revision and writes a transactional outbox event.
- Meilisearch and record-derived integrations react to database revisions, not only Zotero library-version changes.
- Every query, job, item, file, credential, publication, analytics event, AI credit entry, and usage limit belongs to exactly one library.

Each application starts with a library ID, control-plane URL, and machine credential. It validates and caches its versioned manifest, uses the cache only while unexpired, and fails closed for costly or mutating plugins.

CI releases immutable image digests through internal, canary, and controlled waves. Customers can view versions, release notes, maintenance, and results but cannot trigger, defer, pin, or select versions.

Catalog and manifest schemas are versioned; secrets never enter browser data. Each release binds its image, migration, manifest, catalog, and worker-protocol versions, with health checks, restore points, and rollback.

### Verified starting point

The schedule treats only code that exists now as reusable. Repository names and current deployments are not counted as finished platform features.

| Area | Starting state | Roadmap consequence |
|---|---|---|
| Public Evidence Library | Browsing, read pages, search, parts of AI retrieval, and analytics consent exist. | Refactor and extend these paths. |
| Subscription platform | No website, portal, control-plane codebase, platform database, organization model, or operator console exists. | Design and build a new product from zero. |
| Coolify automation | Current deployments provide operational knowledge, but there is no API client, reconciler, release registry, or automated allocator. | Build provisioning and releases as new systems. |
| Accounts and administration | Basic per-library login exists; verified email, invitations, staff roles, settings, deletion, and `/admin` do not. | Replace the account model and add a platform identity contract. |
| Record authoring | The application has no canonical item write model, edit page, field drafts, revision outbox, or database-driven indexing. | Build the authoring path as a new core subsystem. |
| Background work | Existing sync is polling with static targets, not a durable shared queue. | Reuse integration logic, not the worker platform. |
| Crossref and Zenodo | Provider clients, payloads, hashes, journals, identifier parsing, and recovery are strong reusable parts. | Keep the provider engines; replace their combined orchestration and MEE dependency. |
| Billing and credits | No Evidence Library billing system exists. A sibling per-user Stripe implementation offers webhook and reconciliation patterns only; its data model and backend do not fit organizations or libraries. | Build library-scoped billing and credits in the new platform. |
| Design system | Existing library styles may inform the visual direction, but no subscription-site design or shared component package exists. | Do product design, visual design, and component implementation explicitly. |

## Core product

The core must remain useful without any optional plugin:

- Public browsing, the modern item page, basic keyword search, canonical URLs, and published-record sitemaps.
- Structured scholarly metadata, language alternates, social metadata, and JSON-LD.
- One subscription-platform staff identity with separate membership and roles for each library; `/admin` has no public login button.
- Owner, admin, editor, and viewer roles; invitations; verified email; account settings; session management; and safe staff deletion.
- Native record creation, field-level drafts, explicit publishing, canonical revisions, audit history, and search projection.
- Plugin enforcement, manifest handling, provisioning status, and library item-limit enforcement.
- WCAG 2.2 AA across the core and every plugin.
- Fast public rendering with LCP at or below 2.5 seconds, INP at or below 200 ms, and CLS at or below 0.1 at p75 on mobile and desktop.

`new-resource-page` disappears completely. The classic item page is deleted, and the modern item page becomes the only core item page.

### Library item limits

| Maximum active items per library |
|---:|
| 1,000 |
| 10,000 |
| 100,000 |

Each active top-level canonical item counts exactly once, regardless of native or Zotero origin, publication status, or draft patch. Child attachments and deleted items do not count.

At the limit, only new native records and new Zotero imports are blocked. Existing records remain readable, editable, searchable, exportable, synchronizable, and deletable.

## Record and publishing model

### Field-level drafts

Creating a record first creates an unpublished canonical item shell and a field-level draft, then opens `/admin/items/{id}/edit`. The editor overlays that patch on the canonical base.

Publishing applies the patch to the latest base, increments the canonical revision, clears the draft, and emits outbox work.

Incoming Zotero changes update the base while drafted fields remain unchanged; undrafted fields show new Zotero data. There are no locks or merge screens: later publication wins only for fields in its patch.

Accepted Zotero changes queue public-search and active Crossref or Zenodo updates. Unpublished draft fields remain excluded.

Each library chooses whether new Zotero imports auto-publish or arrive as drafts. Draft imports create an unpublished item shell whose imported fields form the initial patch.

### Publication controls

Crossref, Zenodo, and Zotero writeback controls live only on the record edit page. Library publishing commits first; provider jobs run independently with visible status and retries.

A provider failure never rolls back the record, blocks another provider, or loses the saved revision. The public item page displays results but has no authoring controls.

### Crossref and Zenodo separation

Crossref and Zenodo have separate per-item publication records, jobs, status, history, retries, and recovery data.

- Crossref registration never creates a Zenodo record.
- Zenodo can publish alone and mint the record's publication DOI.
- `external-crossref` waits for a confirmed Crossref DOI, then supplies it to Zenodo.
- `dual` publishes independently through both providers, then adds their relationship.

Crossref suffixes are editable and previewed per record until registration, then fixed. Managed and customer-credential variants share provider engines; only credential ownership, prefix ownership, and setup differ.

Publication metadata and files come from the current library database and storage. Zotero is an optional linked-record adapter, never a publishing prerequisite.

The edit page creates provider-specific commands directly. MEE is removed from the flow, the old `ACTIVE` Crossref-DOI candidate gate is deleted, and the combined Zotero-bound planner and executor are split.

Reuse the existing provider clients, payload builders, hashes, journals, recovery, and identifier parsing from `doi-sync-core`; replace its combined host contract and MEE activation dependency.

## Complete plugin catalog

Catalog availability and packaging remain control-plane data.

### Presentation and discovery

| Plugin | User value | Dependencies | Work required |
|---|---|---|---|
| Branding | Make the library recognizable. | — | Runtime logo, favicon, colors, funder identity, uploads, defaults, and removal of repository-bundled branding. |
| Theme Switcher | Choose a comfortable display. | — | Light, dark, and system modes with accessible themes and persistence. |
| Language Switcher | Use the library in supported languages. | — | Runtime locale list, default locale, validation, translated navigation, and routing. |
| Custom Navigation & Footer | Present the institution's links and policies. | — | Configurable navigation, social links, contact/help text, and policy links. |
| Navbar Search | Search from any page. | — | Compact navigation search backed by the core search API. |
| Year Filter | Narrow results by publication year. | — | Facet, counts, URL state, empty states, and index settings. |
| Public Collections | Curate public groups of records. | — | Collection pages, membership, facets, labels, ordering, and source mappings. |
| Collection Notes | Explain a collection. | Public Collections | Editable descriptions and accessible public rendering. |
| Country Focus | Browse evidence by country. | — | Country data, terminology, facet, validation, and indexing. |
| Author Filter | Browse evidence by creator. | — | Creator facet, counts, queries, and removal of current cross-wiring. |
| Author Location | Explore creator geography. | — | Location data, validation, display, facet, and indexing. |
| Downloads & Exports | Reuse records and datasets. | — | Item/file downloads, citations, dataset exports, access checks, and usage events. |
| Atom Feed | Follow new publications. | — | Server feed, caching, metadata configuration, and plugin enforcement. |

### Accounts, files, and engagement

| Plugin | User value | Dependencies | Work required |
|---|---|---|---|
| Public Accounts | Give readers a library account. | — | Registration, login, verified email, open or invite-only mode, settings, sessions, and self-deletion. |
| Public Profiles & Social | Let readers follow people and records. | Public Accounts | Profiles, likes, follows, privacy controls, moderation hooks, and deletion cleanup. |
| Saved Collections | Save private reading lists. | Public Accounts | Private collections, membership, export, limits, and deletion cleanup. |
| File Attachments | Store and read record files. | — | Native upload, Zotero import, checksums, storage records, access rules, preview, download, and retries. |
| Full-Text Search | Search inside attached documents. | File Attachments | Text extraction, searchable fields/chunks, retries, re-indexing, and removal cleanup. |

Staff accounts are core; Public Accounts are separate and library-local. Public registration defaults to open with verified email, while staff access through `/admin` is invitation-only.

Staff deletion requires re-authentication and responsibility transfer; the last owner cannot delete their account. Cleanup preserves necessary audit history without retaining a public profile.

### Zotero and publication

| Plugin | User value | Dependencies | Work required |
|---|---|---|---|
| Zotero Sync | Keep a library current from Zotero. | — | Validate read access; resumable import and deltas; items, collections, notes, relations, files, deletions, checkpoints, health, and import publication setting. |
| Zotero Writeback | Create and update Zotero-linked records. | Zotero Sync | Validate write access; per-item native or linked choice; changed-field create/update/delete, retries, status, and audit. |
| Crossref | Register and maintain Crossref DOIs with customer credentials. | — | Credential/prefix setup, connection test, deposits, verification, updates, suffix preview, history, and recovery. |
| Managed Crossref | Register and maintain DOIs through platform-operated Crossref access. | — | A sponsored membership and prefix for each library, platform-operated credentials, the shared engine, ownership records, support state, and exit records. |
| Zenodo | Publish files and metadata with customer credentials. | — | Token validation, standalone records, files, versions, DOI modes, updates, history, and recovery. |
| Managed Zenodo | Publish through platform-operated Zenodo access. | — | Platform credentials, library ownership records, the shared Zenodo engine, limits, support state, and offboarding. |

The two Crossref variants are mutually exclusive. The two Zenodo variants are mutually exclusive. Published identifiers and Zenodo records remain public after a plugin is disabled; new writes stop.

Zenodo mode is chosen per record before its first Zenodo publication: standalone Zenodo DOI, confirmed Crossref DOI, or dual DOI. That record's mode is fixed after publication.

### AI, analytics, and domains

| Plugin | User value | Dependencies | Work required |
|---|---|---|---|
| AI Suite | Add governed AI capabilities to one library. | — | Platform model credentials, credit ledger, monthly allowance, permanent extra credits, usage, and billing events. |
| Item AI | Ask for help with one record. | AI Suite | Existing item retrieval, summarize/extract/classify actions, fixed credit costs, history, and server-owned prompts. |
| AI Search | Ask questions across the current library. | AI Suite | Grounded retrieval, cited results, fixed credit costs, and clear error states. |
| Deep Research | Run longer research across the current library. | AI Search | Multi-step jobs, progress, cancellation, cited results, storage, and fixed credit costs. |
| Related Resources | Find similar records in the current library. | AI Suite | Similarity jobs, refresh, stored results, and fixed credit costs. |
| Semantic Search | Retrieve by meaning within the current library. | AI Suite | Embeddings, vector storage, rebuild jobs, hybrid retrieval, and fixed credit costs. |
| Library Analytics | Understand consenting use of the current library. | — | Self-hosted PostHog events, filtered dashboards, date/item views, exports, retention settings, and consent reporting. |
| Custom Domain | Use an institutional hostname. | — | Ownership check, DNS guidance, TLS, health, safe replacement, and release integration. |

Each AI action shows a fixed integer cost and deducts it once at start, with no reservation or refund, including failed or cancelled work. Monthly credits reset without rollover and are used first; extra credits never expire or cross libraries.

Keep the existing item-link citation prompting and formatting. Add a stable link that opens the cited attachment page when page data is available; item links remain the fallback.

Runtime checks validate citations against the retrieval trace and reject unused records or pages. The product adds neither a second fact-checker nor a separate AI evaluation suite.

### Analytics rules

One self-hosted PostHog project provides analytics only, never plugins, entitlements, or behavior. Events carry immutable `libraryId` and `organizationId`; cross-library customer queries are forbidden.

Customers see application dashboards filtered to their current library, not PostHog. Disabling Library Analytics stops visitor-usage collection and dashboard access for that library; core health telemetry remains separate.

Reuse the current consent and anonymous-visitor flow. Names, emails, profiles, AI prompts/responses, and session replay are excluded. Billing and credit records stay in PostgreSQL. Dashboards cover consenting traffic only.

## Estimate

One delivery day may contain product definition, information architecture, UX, visual design, content, engineering, review, documentation, operational setup, or proportionate verification. The 420-day base plus an 84-day integration reserve gives a 504-day planning total; migration is a separate 30-day program.

Crossref sponsorship, payment approval, DNS changes, and customer credentials add calendar time, not engineering days.

| Phase | Days | User outcome |
|---|---:|---|
| 0. Contracts and verified boundaries | 10 | Scope, ownership, and technical choices are settled. |
| 1. Image and data foundation | 20 | A clean library starts and restores reliably. |
| 2. Subscription product and design | 16 | The new website and portal are fully designed. |
| 3. Platform codebase and control-plane foundation | 16 | The separate platform has a deployable backend and database. |
| 4. Accounts and `/admin` | 24 | Staff can operate their library through platform identity. |
| 5. Authoring, revisions, and search | 40 | Native records can be published and found. |
| 6. Manifest and plugin runtime | 20 | One path controls optional capabilities. |
| 7. Evidence Library plugin wave | 50 | Product plugins work accessibly. |
| 8. Shared worker platform | 24 | Background work is durable and visible. |
| 9. Zotero Sync and Writeback | 32 | Native and linked records coexist. |
| 10. Crossref and Zenodo publishing | 38 | Providers work alone or together. |
| 11. AI and Library Analytics | 32 | Cited AI and consented analytics work. |
| 12. Coolify provisioning and releases | 34 | Libraries launch and update automatically. |
| 13. Subscription website, portal, and billing | 40 | Customers can subscribe, configure, and operate libraries. |
| 14. Hardening and launch | 24 | Both products are launch-ready. |
| **Base launch** | **420** | |
| **Integration reserve** | **84** | |
| **Planning total** | **504** | |

## Phase 0 — Contracts and verified boundaries (10 days)

| Part | Days | Result |
|---|---:|---|
| Domain and manifest contracts | 2 | Core facts, plugins, dependencies, settings, lifecycle states, safe browser data, and schema versions. |
| Platform architecture choices | 2 | Identity, payment, queue, object storage, email, secret handling, PostHog, and service boundaries are decided. |
| Deletion and ownership inventory | 2 | Every current flag, environment value, customer branch, credential, status, and worker setting has a plugin replacement, final owner, or deletion point. |
| Coolify and provider proofs | 2 | Confirm the required Coolify, registry, DNS, Stripe, Zotero, Crossref, Zenodo, and managed-provider operations. |
| Implementation spikes | 2 | Prove runtime configuration, field drafts, provider-neutral publishing, and the Coolify API path before building them. |

**Gate:** every optional behavior maps to one plugin, and every data path is scoped to one library.

## Phase 1 — Image and data foundation (20 days)

| Part | Days | Result |
|---|---:|---|
| Runtime and image seam | 4 | Customer data leaves the build; one immutable image starts from runtime infrastructure values. |
| Database bootstrap and migrations | 5 | Checked-in migrations, clean database creation, seed data, and library-scoped roles. |
| Object-storage foundation | 3 | Library prefixes, service credentials, checksums, retention, and restore rules. |
| Health, backup, and restore proof | 4 | Readiness checks plus blank-library database and storage restore exercises. |
| Core application boundary | 4 | Library context, server authorization helpers, audit primitives, and safe public configuration. |

**Gate:** the same digest starts against two separate library databases without build-time customer configuration.

## Phase 2 — Subscription product and design (16 days)

| Part | Days | Result |
|---|---:|---|
| Product scope and journeys | 3 | Public visitor, customer owner, invited staff, and operator journeys cover signup through ongoing operation. |
| Information architecture and content | 3 | Sitemap, navigation, page inventory, terminology, help, status, contact, and legal content requirements. |
| UX flows and wireframes | 4 | Public site, signup, organization, library setup, configuration, billing, status, recovery, and settings flows. |
| Prototype and system states | 2 | A clickable responsive prototype includes empty, loading, validation, failure, retry, pause, and resume states. |
| Visual direction and component specification | 4 | Accessible typography, color, spacing, components, interaction rules, and responsive behavior are ready to implement. |

**Gate:** the complete greenfield product is designed and reviewed; implementation is not being inferred from Evidence Library screens.

## Phase 3 — Platform codebase and control-plane foundation (16 days)

| Part | Days | Result |
|---|---:|---|
| Repository and application structure | 4 | New standalone codebase, shared contracts, local development, formatting, CI, and separate web/API/worker entry points. |
| Platform database and API | 5 | Organizations, libraries, catalog, desired state, manifests, machine credentials, audit trail, and schema migrations. |
| Environments and deployment | 3 | Local, staging, and production configuration plus a first deployment in the new Coolify project. |
| Operational baseline | 2 | Structured logs, health, alerts, backup, restore, and release metadata for the platform itself. |
| Secret and machine-auth foundation | 2 | Server-only credential storage, rotation path, scoped machine access, and safe browser projections. |

**Gate:** the new platform deploys independently, stores a library definition, and serves a signed versioned manifest without using an Evidence Library database.

## Phase 4 — Accounts and `/admin` (24 days)

| Part | Days | Result |
|---|---:|---|
| Platform identity and cross-domain session | 7 | Verified email, login, recovery, secure sessions, and a defined token/session exchange with library deployments. |
| Organizations, libraries, and invitations | 5 | Platform accounts, organization membership, library membership, invitations, and explicit current-library context. |
| Staff roles and protected admin | 5 | Owner, admin, editor, and viewer rules across routes and actions, with no public login button. |
| Account settings | 4 | Profile, email, password, sessions, organization, library, and invitation management. |
| Deletion and audit | 3 | Re-authentication, last-owner protection, responsibility transfer, cleanup, and retained audit history. |

**Gate:** staff can complete invitation, administration, settings, and safe deletion without Public Accounts.

## Phase 5 — Authoring, revisions, and search (40 days)

| Part | Days | Result |
|---|---:|---|
| Canonical schema and migrations | 7 | Items, creators, identifiers, collections, notes, files, sources, tombstones, constraints, and monotonic revisions. |
| Field drafts and publishing | 6 | Unpublished item shells, patch-based drafts, latest-base application, explicit publish, and Zotero-base update behavior. |
| Write API and record edit page | 10 | Create, edit, publish, delete, restore, validation, audit, autosave, and `/admin/items/{id}/edit`. |
| Outbox and Meilisearch | 7 | Transactional events and retryable, idempotent projection driven by every canonical database revision. |
| Discoverability foundation | 4 | Published-only metadata, canonical URLs, sitemaps, language links, social metadata, and JSON-LD. |
| Imports and item limits | 6 | Static import plus 1k, 10k, and 100k limit enforcement, usage reporting, and safe downgrade behavior. |

**Gate:** a library without Zotero can author, publish, search, delete, restore, and rebuild its index.

## Phase 6 — Manifest and plugin runtime (20 days)

| Part | Days | Result |
|---|---:|---|
| Catalog and manifest completion | 4 | Dependencies, configuration schemas, lifecycle rules, safe browser fields, revisions, and compatibility checks. |
| Manifest client | 4 | Validation, refresh, last-known-good cache, expiry rules, and safe browser projection. |
| Server and browser enforcement | 4 | Typed plugin/config access with server authority over every protected action. |
| Feature-path replacement | 4 | Map useful current flags to plugins, then delete PostHog flags, `new-resource-page`, and the classic page. |
| Runtime configuration cleanup | 4 | Remove build variables, customer-name branches, and repository-bundled customer configuration. |

**Gate:** two differently configured libraries run the same digest, and no PostHog flag controls behavior.

## Phase 7 — Evidence Library plugin wave (50 days)

| Part | Days | Result |
|---|---:|---|
| Presentation plugins | 8 | Branding, Theme Switcher, Language Switcher, Custom Navigation & Footer, and Navbar Search. |
| Discovery plugins | 10 | Year Filter, Public Collections, Collection Notes, Country Focus, Author Filter, and Author Location. |
| Public account plugins | 9 | Public Accounts, Public Profiles & Social, and Saved Collections. |
| File plugins | 9 | File Attachments and Full-Text Search with storage, extraction, retries, and cleanup. |
| Exports and feeds | 5 | Downloads & Exports and Atom Feed with server enforcement. |
| Accessibility, performance, and first user checkpoint | 9 | Plugin setup states, WCAG fixes, public rendering work, Core Web Vitals measurement, and workflow feedback. |

**Gate:** every listed plugin can be configured without a rebuild and works through its public or admin surface.

## Phase 8 — Shared worker platform (24 days)

| Part | Days | Result |
|---|---:|---|
| Durable jobs | 8 | Claims, leases, retries, schedules, dead letters, idempotency, cancellation, and provider limits. |
| Library and source registry | 5 | Scoped credentials, checkpoints, capabilities, and health replace static worker target lists. |
| Shared protocol | 4 | One job/event contract for indexing, files, Zotero, publishing, AI, analytics, and provisioning. |
| Existing-worker adapters | 3 | Reusable polling and integration logic enters the durable protocol without keeping static target lists. |
| Operations surface | 4 | Last attempt, success, lag, failure, pause, retry, and worker visibility. |

**Gate:** enabling and configuring a plugin creates claimable work without editing worker environment JSON.

## Phase 9 — Zotero Sync and Writeback (32 days)

| Part | Days | Result |
|---|---:|---|
| Connection and inbound sync | 10 | Read validation, resumable import/deltas, content, deletions, checkpoints, and a per-library auto-publish or import-as-draft setting. |
| Record source and linkage | 4 | Per-item native or Zotero-linked choice, item key, Zotero version, and source status. |
| Changed-field writeback | 8 | Write validation, create/update/delete, version refresh, idempotency, retries, and failure status. |
| Attachments and recovery | 6 | File integration, credential failure, reconnect, deletion, and repeated-write recovery. |
| Admin controls | 4 | Sync and writeback state, retry, disconnect, last result, and audit on the record edit page. |

**Gate:** inbound Zotero changes update the published base while draft fields remain; writeback failure never rolls back publication.

## Phase 10 — Crossref and Zenodo publishing (38 days)

| Part | Days | Result |
|---|---:|---|
| Provider-neutral snapshots | 6 | Published database metadata and files feed either provider, with a Zotero-linked adapter and no MEE prerequisite. |
| Separate publication state and jobs | 5 | Independent Crossref and Zenodo records, commands, status, history, retries, and recovery state. |
| Crossref variants | 7 | Customer and managed credentials, setup, suffix choice, deposit, verification, update, pending state, and recovery. |
| Zenodo variants | 7 | Customer and managed credentials, standalone publication, files, versions, updates, identifiers, and recovery. |
| Combined DOI modes | 5 | Per-record standalone, external-Crossref, or dual choice; waiting rules; later relationships; and fixed published mode. |
| Record edit UI | 4 | Provider cards, preview, status, history, errors, retry, and published identifiers. |
| Writeback and recovery hardening | 4 | Optional Zotero identifier writeback, idempotent adoption, collision handling, and permanent-side-effect recovery. |

**Gate:** a native record can use either provider alone or both modes, and no provider failure blocks the library or the other provider.

## Phase 11 — AI and Library Analytics (32 days)

| Part | Days | Result |
|---|---:|---|
| AI catalog, credits, and jobs | 5 | Fixed action costs, single start deduction, no reservation/refund, monthly reset, permanent extras, and library-scoped usage. |
| Item AI and AI Search | 6 | Existing retrieval preserved, server-owned prompts/models, grounded results, citations, and history. |
| Deep Research, Related Resources, and Semantic Search | 8 | Current-library jobs, progress, results, embeddings, hybrid retrieval, and rebuilds. |
| Citation improvements | 4 | Stable item/page links, item fallback, and retrieval-trace validation for records and pages. |
| Self-hosted PostHog pipeline | 5 | Deployment, reused consent flow, anonymous events, library tags, no prompt/response capture, retention, and no flags or replay. |
| Dashboards and second user checkpoint | 4 | Current-library dashboards, exports, consenting-traffic notice, Web Vitals, and integrated workflow feedback. |

**Gate:** AI cannot search another library, citations resolve, credits charge once at start, and analytics cannot expose another library.

## Phase 12 — Coolify provisioning and releases (34 days)

| Part | Days | Result |
|---|---:|---|
| Coolify API client and desired-state store | 5 | Typed API operations, resource records, credentials, idempotency keys, and observed state. |
| Desired and observed reconciler | 7 | Retryable provisioning steps, history, drift detection, and convergence after partial failure. |
| Evidence Library application adapter | 6 | One pinned-image deployment per library with bootstrap values, health checks, limits, and platform hostname. |
| Shared-service allocation | 7 | Database/role, Meilisearch index/key, storage prefix, backup policy, and worker registrations. |
| Release operations | 6 | Registry, build/publish pipeline, migrations, internal/canary/waves, health gates, rollback, and digest reconciliation. |
| Custom Domain plugin | 3 | Ownership check, DNS/TLS workflow, status, safe replacement, and collision detection. |

**Gate:** a blank library is created end to end, retries create no duplicates, and no old-project resource can be changed.

## Phase 13 — Subscription website, portal, and billing (40 days)

| Part | Days | Result |
|---|---:|---|
| Implemented design system | 5 | Responsive accessible components, layouts, forms, tables, status patterns, and documented states implement the approved design. |
| Public website | 5 | Home, product explanation, plugin catalog, how it works, signup entry, help, contact, status, legal surfaces, metadata, and navigation. |
| Customer application shell | 4 | Account, organization, team, current-library switcher, invitations, notifications, and navigation. |
| Catalog-driven configurator | 5 | Item limits and the full plugin catalog render from control-plane definitions, dependencies, setup, and active state. |
| Checkout and billing lifecycle | 7 | Checkout, subscriptions, changes, portal, invoices, signed idempotent webhooks, recovery, and AI credit packs. |
| Resumable setup wizard | 6 | Library identity, plugins, credentials, Zotero permissions, provider setup, domains, readiness, provisioning progress, failure, and resume. |
| Customer dashboard and settings | 4 | Library usage, provisioning, sync, providers, releases, account/team settings, suspension, reactivation, deletion, and export. |
| Operator, email, and support surfaces | 4 | Operator visibility and safe retries plus transactional email, customer notices, audit access, and support handoff. |

The site distinguishes selected, enabled, setup required, ready, provisioning, active, degraded, suspended, and failed. Setup is saved server-side and resumable. The browser never guesses completion from a timeout or maintains a second handwritten plugin list.

**Gate:** a customer can configure and launch a library without an operator editing Coolify, source code, environment variables, or worker lists.

## Phase 14 — Hardening and launch (24 days)

| Part | Days | Result |
|---|---:|---|
| Monitoring and failure recovery | 5 | Platform, application, queue, provider, provisioning, email, billing, and analytics health with actionable stored failures. |
| Backup, restore, and rollback | 4 | Automated platform and library backups, index rebuild, full restore, and failed-release rollback exercises. |
| Load and isolation | 6 | Database, queue, provider, manifest, item-limit, plugin, billing, publication, AI, website, and provisioning pressure checks. |
| Accessibility, performance, and discoverability | 4 | WCAG 2.2 AA and p75 Core Web Vitals proof for both products, plus metadata and published-only indexing checks. |
| Runbooks and launch | 5 | Operator and customer guidance, billing/provider incidents, recovery procedures, dead-code deletion, and controlled launch. |

**Gate:** every major failure has a visible state and demonstrated recovery path. A Git push alone cannot update customer libraries.

## Post-launch existing-library migration (30 days)

| Part | Days | Result |
|---|---:|---|
| Read-only inventory and importer | 8 | Build repeatable dry-run imports from old exports without writing to old resources. |
| Source and provider adoption | 7 | Import sources, credentials, checkpoints, identifiers, effective DOI modes, permanent-provider state, and local-only data without duplicate writes. |
| Representative canaries | 5 | Rebuild and compare representative libraries on new hostnames across counts, pages, search, files, plugins, embeddings, and sync. |
| Remaining waves | 8 | Move the remaining approved libraries through the same repeatable comparison, approval, and recovery process. |
| Migration cleanup | 2 | Remove temporary readers from new code while leaving the old project and databases untouched. |

Old and new deployments use different hostnames while both remain active. Reusing an old production hostname requires a separately approved routing action.

## Delivery order

Build the two products in parallel where their contracts meet. Define the subscription product early, then create the platform codebase, database, identity contract, catalog, and manifest API before the Evidence Library depends on them. The polished website and portal can follow real catalog, billing, provisioning, and status APIs; their foundation cannot wait until the end.

Within the Evidence Library, foundations precede plugins, revisions precede integrations, and shared workers precede background features. Within the platform, design precedes interface implementation, the control plane precedes its portals, and desired state precedes Coolify reconciliation.

Recovery, isolation, accessibility, and performance proof precede launch. Prioritize by user value, dependencies, cost, and irreversible-provider risk; use numeric scoring only after real usage exists.

## Main risks

1. **Permanent publishing:** store intent, idempotency, history, and recovery for DOI and deposit actions.
2. **Zotero and drafts:** preserve field patches while Zotero updates the base.
3. **Runtime cleanup:** remove build-time and customer-specific decisions.
4. **Isolation:** enforce database, search, storage, analytics, AI, credential, and worker boundaries.
5. **Provider waits:** treat managed Crossref and approvals as calendar risk.
6. **Two-product drift:** keep shared schemas and terminology in the platform codebase rather than copying them between the portal and Evidence Library.
7. **Greenfield depth:** revise estimates after Phase 0 when technical choices are proven instead of treating missing systems as configuration work.
