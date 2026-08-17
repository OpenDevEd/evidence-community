# Crossref and Zenodo publication

Status: Evidence Library phases 02-06 are implemented on `codex/doi-publication-integration`, but that branch is not merged or deployed. Phase 08 now owns the clean integration into the current `openscholar` branch and the `docs-pen` sandbox canary. Production provider writes remain out of scope.

## Goal

Add manually activated, per-item Crossref and Zenodo publication to the Evidence Library. PostgreSQL remains canonical, `@opendeved/doi-sync-core` remains the shared provider engine, and each activated item receives durable progress, retries, receipts, reconciliation, and administrator-visible failures.

## Grounding snapshot

| Repository | Branch | Inspected revision | Role |
|---|---|---:|---|
| `OpenDevEd/new-el` | `openscholar` | `2f5e8157fe7fef9ed8028426c6c421ef95e5a8ca` | Canonical records, files, runtime configuration, admin UI, jobs, and worker runtime |
| `OpenDevEd/doi-sync-core` | `openscholar` | `9816cde6f80e02c45ecd9242b03c1f2e3f1c698e` | Completed provider-neutral Crossref and Zenodo planning/execution/settlement engine |
| `OpenDevEd/mee-doi-sync-worker` | `openscholar` | `66a8721f0c5529e5a6633457c390cc41bdf1f30a` | Completed MEE adapter and operational donor; not the Evidence Library worker |

The completed core verification suite passed with 293 tests. The completed MEE worker verification suite passed with 146 tests. Both branches are pushed at the exact revisions above.

Required Outline context was read before planning: Start Here, Evidence Library current state, Architecture and data ownership, and Current decisions. This plan does not update Outline because it is uncommitted planning work.

## Locked decisions

1. Crossref and Zenodo activation are manual per item. Merely publishing or editing an Evidence Library item never opts it into either provider.
2. Each provider has its own durable activation target. Only activated targets participate in immediate delivery and nightly reconciliation.
3. Administrators activate providers from the selected item's admin inspector and see persisted progress, errors, retry state, identifiers, and receipts.
4. Zenodo defaults to `reuse-crossref`: an active Crossref DOI is supplied to Zenodo for the same work.
5. `mint-zenodo` is an explicit alternative. Zenodo then mints a version DOI and concept DOI. If Crossref is also active, the Zenodo object is treated as a separately versioned archive and the Crossref record relates to the current Zenodo version with `isSupplementedBy`.
6. The Zenodo identifier policy becomes immutable when the first Zenodo record is published.
7. A Zenodo activation without a published file remains locally `waiting_for_file`; it does not create an empty remote draft.
8. Crossref activation is available only for item types with an explicit, schema-valid Crossref 5.5 mapping. There is no generic report fallback.
9. A DOI found only in item metadata remains an external bibliographic identifier, even when it uses the configured Crossref prefix. Reuse is valid only when this library already has a managed `publicationIdentifier` row for the item. This work does not adopt existing DOIs.
10. DOI discovery normalizes the canonical `item.DOI` field, Zotero-style `extra` metadata, and DOI link attachments tagged `_r:doi` before classification. Conflicting values block activation; an existing DOI in any source can never fall through to allocation.
11. Immediate jobs are the delivery path. Nightly reconciliation is the repair path.
12. Crossref test and Zenodo Sandbox must pass the complete real-service matrix before any production-enablement work is planned.
13. No production provider writes are part of phases 01-07.
14. Provider-neutral core and MEE adapter work happens only on each repository's `openscholar` branch. Their `main` branches remain untouched.
15. A newly allocated Crossref DOI becomes the canonical item DOI as soon as it is reserved. The item, search projection, and ordinary source writeback expose it immediately, while the publication target remains `reserved` or in progress until Crossref verifies it.
16. The browser never chooses a Crossref prefix or constructs a DOI. The prefix and a library-specific suffix namespace come from validated server-only configuration; PostgreSQL allocates the next suffix atomically.
17. The admin UI reads one server-built publication view. It does not combine jobs, journals, provider state, and identifiers in browser state.

## Supported Crossref activation types

The initial allowlist is the intersection of Evidence Library item types and direct Crossref 5.5 record models:

| Evidence Library item type | Crossref 5.5 model | Additional activation validation |
|---|---|---|
| `JournalArticle` | `journal/journal_article` | Publication title; journal metadata required by the selected schema path |
| `Book` | `book/book_metadata` | Publisher and publication date |
| `BookSection` | `book/content_item` with `chapter` or `section` | Parent book title and publisher metadata |
| `DictionaryEntry` | `book/content_item` with `reference_entry` | Dictionary title and publisher metadata |
| `EncyclopediaArticle` | `book/content_item` with `reference_entry` | Encyclopedia title and publisher metadata |
| `ConferencePaper` | `conference/conference_paper` | Conference or proceedings title |
| `Thesis` | `dissertation` | University or institution |
| `Report` | `report-paper` | Institution or publisher |
| `Standard` | `standard` | Standards body or issuing authority |
| `Dataset` | `database` with dataset content | Dataset publication date and publisher/institution |
| `Preprint` | `posted_content type="preprint"` | Posted date and hosting institution |
| `BlogPost` | `posted_content type="blog"` | Posted date and hosting identity |
| `Letter` | `posted_content type="letter"` | Posted date and hosting identity |
| `Document`, `Manuscript` | `posted_content type="other"` | Explicit confirmation that the item is posted content, plus posted date and hosting identity |
| `Presentation` | `posted_content type="poster"` | Only when the item's presentation type explicitly identifies a poster |

Every other item type receives an actionable unsupported-type validation response. Adding a type requires a mapper, XSD fixture, provider test, and documentation update.

Zenodo uses its own controlled vocabulary and is not constrained to this Crossref allowlist. Its mapper must still be explicit; it may use Zenodo's documented `other` type only when no more precise documented type applies.

## Gap audit

| Concern | Current state | Required change |
|---|---|---|
| Initial DOI activation | MEE owns a Zotero-driven Crossref-only flow; the shared core only accepts already-active DOIs | Add provider-neutral reservation and activation planning, owned by Evidence Library |
| Shared model | Core inputs are `ZoteroParentItem`, `ZoteroChildItem`, and a required Crossref DOI | Replace them with provider-neutral publication metadata, files, targets, and identifiers |
| Crossref schema | Core emits `report-paper` under schema 5.4.0 for every item | Emit schema 5.5.0 through explicit record-type mappers and validate against the official XSD |
| Zenodo type mapping | Core always emits publication/report | Map Evidence Library types to documented Zenodo upload/publication vocabularies |
| Zenodo without Crossref | Core requires a Crossref DOI | Allow an independently activated `mint-zenodo` target |
| File source | Core builds manifests and downloads bytes from Zotero | Read published files from `itemFilePublication` and the configured storage service |
| Durable state | MEE worker stores state in a second database | Store publication targets, identifiers, jobs, journals, runs, and receipts in the library PostgreSQL database |
| Scheduling | MEE container sleeps and exposes a one-shot CLI | Add an Evidence Library publication worker plus a leased nightly reconciliation scan |
| Admin controls | No DOI publication controls exist | Add manual activation, progress, retry, and provider links to `AdminInspector` |
| Runtime configuration | No Crossref or Zenodo service configuration exists | Add validated server-only configuration and synchronized generated artifacts |
| Real-service proof | The MEE worker contains a gated `smoke:sandbox` runner; the core has no live smoke command | Use the worker smoke as a baseline, then add an Evidence Library end-to-end Crossref test and Zenodo Sandbox matrix |

## Current implementation inventory

### Evidence Library

- `package.json` pins `@opendeved/doi-sync-core` at `63f9645b...`, and `src/components/features/newlib/ItemPage.tsx` uses its DOI display API on public library routes. Phase 01 must retain a provider-neutral display module; phase 02 upgrades the pin and migrates this active consumer in the same green change.
- `src/lib/utils.ts` displays a DOI from either `item.DOI` or Zotero-style `extra`; activation must reuse this normalization rule without mutating through the display helper.
- `src/lib/search.ts` projects DOI into Meilisearch, so any canonical DOI mutation must enqueue its search outbox event transactionally.
- `src/db/schema/source.ts` instantiates current source/file-publication tables; publication tables will live in the dedicated `src/db/schema/publication.ts` module and be registered by `src/db/database-schema.ts`.
- `tests/acceptance/compose.yaml` has no publication worker or deterministic provider fake today. Phases 05-06 explicitly add those harness services.

### `doi-sync-core`

- Zotero coupling spans `src/zotero/`, `src/doi.ts`, `src/ports.ts`, `src/preparation.ts`, `src/intended-diff.ts`, `src/display.ts`, `src/metadata-audit.ts`, `src/metadata.ts`, `src/files.ts`, and `src/planner.ts`; phase 01 removes or relocates the whole boundary rather than editing only the planner. Generic DOI normalization and display-link construction remain in core with provider-neutral inputs.
- Current file snapshots use stable file fields plus MD5 and mtime. Phase 01 replaces MD5/mtime with size and SHA-256; source version counters are already excluded.

### MEE worker

- Environment-scoped leases, run summaries, and real-provider smoke composition are reusable operational donors.
- Candidate selection uses offset paging and is explicitly not a donor for the Evidence Library nightly keyset scan.

## DRY donors

### `doi-sync-core`

- `src/planner.ts`: pure plan construction and provider ordering.
- `src/snapshots.ts`: stable provider payload/file snapshots and hashes.
- `src/settlement.ts` and `src/live-settlement.ts`: last-success settlement.
- `src/crossref/xml.ts`: Crossref XML construction donor.
- `src/crossref/client.ts`: multipart submission, diagnostic polling, and verification.
- `src/zenodo/client.ts`: draft, upload, publish, edit, recovery, and version flows.
- `src/zenodo/journal.ts`, `src/recovery.ts`, and `src/zenodo/state-hints.ts`: crash recovery.
- `src/resilience/`: bounded retries and rate limiting.

### Evidence Library

- `packages/evidence-library-core/src/schema.ts`: job leases, idempotency, dead letters, sync runs, and file-publication schema donors.
- `src/lib/source-writeback/queue.ts` and `consumer.ts`: transactional job creation and serialized delivery.
- `src/lib/search-index/consumer.ts`: entity leases, retries, worker state, and exact receipts.
- `src/lib/source-ingestion/orchestrator.ts`: leased singleton runs and heartbeat behavior.
- `src/lib/admin/native-item-service.ts`: canonical item mutation/revision transactions.
- `src/lib/admin/native-file-service.ts`, `file-storage.ts`, and `file-runtime.ts`: published file and storage access.
- `src/lib/admin/source-writeback-contract.ts` and `AdminSourceWritebackStatus.tsx`: status-contract and accessible progress presentation donors. The new UI uses SWR rather than copying the existing effect-based polling hook.
- `src/config/library-config/schema.ts` and `tools/generateLibraryConfigArtifacts.ts`: server-only configuration and generated artifacts.

### MEE worker

- Environment-scoped leases, run summaries, and real-provider smoke composition are operational donors.
- MEE record SQL, Clerk credentials, Zotero-as-canonical assumptions, a second worker database, and Zotero writeback operations are not transplanted.
- MEE's offset-based candidate paging is not reused; the Evidence Library reconciler uses keyset pagination over activated target identity.

## Target architecture

```text
Manual admin action
  -> canonical PostgreSQL transaction
       -> publication target + immutable identifier reservation
       -> canonical DOI + item revision
       -> publication job + receipt
       -> search-index outbox event
       -> ordinary source-writeback job when allowed
  -> publication worker
       -> provider-neutral snapshot from canonical item + published files
       -> doi-sync-core plan / execute / settle
       -> Crossref test or Zenodo Sandbox
       -> provider state + receipt
       -> provider state + receipt update after verification
       -> search-index outbox event when later managed identifiers settle

Canonical item/file mutation
  -> publication job only for existing activated targets

Nightly reconciler
  -> scans only activated targets
  -> compares current hashes and remote/pending state
  -> enqueues missing work
```

Crossref, Zenodo, and source writeback remain separate delivery concerns. Core execution never writes Zotero directly for the Evidence Library. A canonical DOI change uses the existing source-writeback subsystem when the source and item permit writeback.

## Data ownership

- The normalized bibliographic DOI resolved from `item.DOI`, Zotero-style `extra`, or a DOI link attachment tagged `_r:doi` remains the item's canonical bibliographic identity. Conflicting sources are invalid rather than silently preferred.
- `publicationIdentifier` is authoritative for identifiers managed by an activated publication target and distinguishes managed Crossref DOI, external DOI classification, Zenodo version DOI, and Zenodo concept DOI.
- The public search projection combines bibliographic identity with normalized managed publication identifiers. It does not infer managed state from `extra`, attachment tags, or display links.
- `publicationTarget` is the explicit opt-in. It stores activation facts and provider policy, not a second copy of queue progress.
- `publicationSyncState` stores last-success hashes, snapshots, provider IDs, and pending Crossref verification.
- `publicationSyncJob` stores durable attempts, leases, retries, supersession, and dead letters.
- `zenodoPublishJournal` makes draft preparation and publish recovery crash-safe.
- Provider environment is part of all target/state/job uniqueness. Sandbox success can never satisfy production state.

## Runtime configuration

Add a server-only `services.publication` section:

- `crossref.enabled`
- `crossref.environment`: initially only `test`
- depositor name, email, login ID, password, registrant, Crossref-assigned prefix, and library-specific suffix namespace
- `zenodo.enabled`
- `zenodo.environment`: initially only `sandbox`
- token, default identifier policy, access right, and license
- worker batch size, lease seconds, retry ceiling, and nightly UTC schedule

Cross-field validation enforces:

- `reuse-crossref` requires Crossref configuration.
- The Crossref prefix and suffix namespace are non-empty and DOI-safe.
- The suffix namespace is immutable after the first DOI reservation. A namespace must be unique among libraries sharing a Crossref prefix; future OpenScholar provisioning owns that cross-library assignment.
- Test/sandbox are the only accepted environments until phase 07's evidence exists and a separate production plan changes the schema.
- Publication services never appear in the public configuration projection.

The Crossref member account supplies the prefix. The Evidence Library supplies only the opaque suffix. The first format is `<prefix>/<suffixNamespace><zero-padded sequence>`, for example `10.1234/el.000001`. The sequence is readable but carries no item metadata. The database counter and a unique DOI constraint prevent reuse inside one library; the per-library namespace prevents clashes when several libraries share one Crossref prefix.

## Testing strategy

1. Pure mapping, validation, hashing, planner, and settlement logic follows red-green-refactor in `doi-sync-core`.
2. Database lifecycle tests use real PostgreSQL and assert rows, revisions, idempotency, leases, receipts, and dead letters.
3. HTTP tests assert authorization, status contracts, duplicate-click behavior, and human-readable validation errors.
4. Worker contract tests use deterministic provider fakes for retries, conflicts, pending verification, and crash recovery.
5. Real-service tests use Crossref test and Zenodo Sandbox only.
6. Admin UI tests use roles, accessible names, live status text, and provider links. Layout is verified in a real browser with computed CSS and screenshots; no Tailwind/class-string assertions.
7. Final regression runs include core checks, schema generation checks, focused Evidence Library verifiers, unit tests, acceptance tests, and browser tests.

## Migration stance

The development database is disposable. Add clean tables and constraints without compatibility columns or backfills. Reset and reseed local development data when the schema lands. Do not alter production databases or existing Evidence Library tenants.

## Dependencies and ordering

1. Phase 01 is complete at the exact shared repository revisions above.
2. Phase 02 adds Evidence Library state and configuration, advances the active `@opendeved/doi-sync-core/display` consumer, and creates the one read model used by the API and UI.
3. Phases 03-05 add activation, delivery, recovery, and reconciliation without UI-only state.
4. Phase 06 adds the admin inspector controls over those finished contracts.
5. Phase 07 proves the complete system against test providers and produces the evidence required for a separate production-enablement plan.

## Delegation policy

- One agent owns each repository at a time.
- Worktrees and commands must verify the active branch is `openscholar` before editing either shared repository; do not commit provider-neutral work to `main`.
- Cross-repository work is sequenced by exact core commit rather than overlapping edits.
- Independent reviewers receive the complete plan, locked decisions, base revisions, and provider-documentation links.
- No reviewer may mutate providers, commit, push, or update Outline unless separately authorized.

## Grounding sources

- [Crossref metadata deposit schema](https://www.crossref.org/documentation/schema-library/metadata-deposit-schema/)
- [Crossref schema 5.5.0](https://www.crossref.org/documentation/schema-library/metadata-deposit-schema-5-5-0/)
- [Crossref metadata updates](https://www.crossref.org/documentation/register-maintain-records/maintaining-your-metadata/updating-your-metadata/)
- [Crossref record registration](https://www.crossref.org/documentation/register-maintain-records/)
- [Zenodo REST API](https://developers.zenodo.org/)
- [Zenodo existing DOI guidance](https://help.zenodo.org/docs/deposit/describe-records/reserve-doi/)
- [Zenodo file modification policy](https://help.zenodo.org/docs/deposit/manage-files/)
- [Zenodo version management](https://help.zenodo.org/docs/deposit/manage-versions/)
- `AGENTS.md`
- `docs/evidence-library-operations.md`
- `docs/source-writeback.md`
- `docs/search-indexing.md`
- `packages/evidence-library-core/src/schema.ts`
- `../mee/doi-sync-core/README.md`
- `../mee/mee-doi-sync-worker/README.md`
- `../mee/mee-doi-sync-worker/DECISIONS.md`

## Execution plans

1. [01 — Provider-neutral DOI sync core](./01-provider-neutral-core.md)
2. [02 — Publication state and runtime configuration](./02-publication-state-and-config.md)
3. [03 — Manual Crossref activation](./03-crossref-activation.md)
4. [04 — Manual Zenodo activation](./04-zenodo-activation.md)
5. [05 — Durable delivery and nightly reconciliation](./05-worker-and-reconciliation.md)
6. [06 — Admin DOI publishing UI](./06-admin-publication-ui.md)
7. [07 — Real sandbox qualification and documentation](./07-sandbox-qualification.md)
8. [08 — Current-branch integration and docs-pen canary](./08-openscholar-integration-and-docs-pen-canary.md)
