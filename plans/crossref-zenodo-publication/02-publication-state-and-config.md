# 02 — Publication state and runtime configuration

## Goal

Add clean Evidence Library persistence and server-only configuration for manual provider activation, durable jobs, identifiers, receipts, recovery, and environment isolation.

## Scope

- Evidence Library schema and disposable development migration.
- Typed runtime manifest and generated schema/catalog artifacts.
- Provider-neutral repository and configuration ports.
- Atomic migration of the existing public item-page DOI display consumer to the phase-01 core contract.
- No admin mutation routes, provider calls, or UI.

## Design

Add normalized tables:

- `doiNamespace`: configured Crossref prefix/suffix namespace, next sequence, and timestamps. Allocation uses a locked/upserted counter and never recycles values.
- `publicationTarget`: item, provider, environment, selected Zenodo policy, requested actor/time, and optional deactivation time. Its active existence is the opt-in gate. It does not duplicate job or provider progress.
- `publicationIdentifier`: item, registrar, identifier role (`primary`, `version`, `concept`), DOI, ownership (`managed`, `external`), lifecycle (`reserved`, `verified`), provider environment, and timestamps. A reserved managed Crossref DOI is already canonical and public; lifecycle says whether Crossref has verified it.
- `publicationSyncState`: last-success payload/file hashes and snapshots, Crossref pending batch fields, Zenodo record/parent IDs, last failure, and consecutive failure count.
- `publicationSyncJob`: item/provider/environment, canonical and file revisions, reason, idempotency key, attempts, next attempt, lease, processed/dead-letter/superseded state, and result receipt.
- `zenodoPublishJournal`: prepared draft identity, operation, hashes, and resolved/published state.
- `publicationSyncRun`: immediate/nightly/manual run identity, lease/heartbeat, counts, result, and failure.

Use foreign keys to canonical item identity and constraints matching the existing outbox/source-writeback invariants. Provider environment participates in uniqueness. Identifier rows are immutable after activation except for adding a new Zenodo version identifier and changing which version is current.

Add `services.publication.crossref`, `services.publication.zenodo`, and worker settings to the server schema. The initial environment enums accept only `test` and `sandbox`; production values are deliberately absent. Crossref configuration contains the member-assigned prefix and a library-specific opaque suffix namespace. Neither value is user-editable in the item UI. The suffix namespace cannot change after the first reservation. Activation compares the validated config values with the persisted `doiNamespace` row and fails with an actionable configuration error if either differs after a reservation exists.

Add one server-side `buildAdminPublicationView(itemKey)` read service. It reads the canonical item, published files, target rows, identifier rows, provider sync state, and latest jobs, then runs the pure core planner without provider calls. It returns the only status contract consumed by the admin route and UI. Do not persist a second display status.

The contract keeps exact machine state and simple display state separate:

- Exact state: target activation, identifier lifecycle, current core plan, latest job state, attempts, next retry, provider pending/journal state, and latest receipt.
- Display state per provider: `inactive`, `blocked`, `waiting`, `queued`, `working`, `verifying`, `retrying`, `repair_pending`, `synced`, or `failed`. `waitingOn` is `crossref` or `file` when needed.
- Capabilities: whether activation is allowed, the action label, plain-language blockers, allowed Zenodo identifier policies, and the non-secret DOI prefix/namespace preview.
- Links: the reserved or verified DOI, Zenodo record, and concept DOI when their durable identifiers exist. A reserved DOI link is labeled `Reserved`, not `Active`.

The read model first selects the current active target and its newest non-superseded job chain. Old failed jobs and receipts remain available in details but cannot override newer queued or successful work.

The display state is then derived in this order: unsupported/configuration/DOI conflict; no target; Zenodo waiting for verified Crossref or a published file; active lease; pending Crossref verification or Zenodo journal; scheduled retry; queued job; a dead letter or permanent failure when it is the newest non-superseded job; core plan is a no-op with matching last-success state; otherwise `repair_pending`. `repair_pending` means the current record needs provider work but no runnable job exists, so nightly reconciliation must repair it. `synced` always requires a no-op plan for the current canonical record and published-file hashes. This order has contract tests so two screens cannot interpret the same rows differently.

Advance the existing active `@opendeved/doi-sync-core/display` dependency to the exact phase-01 commit and migrate `ItemPage` in the same green change. Add a shared Evidence Library `bibliographic-doi.ts` normalizer/resolver and `publication-display-adapter.ts` to map Evidence Library bibliographic fields (`item.DOI`, Zotero-style `extra`, and DOI link attachments tagged `_r:doi`) plus normalized `publicationIdentifier`/provider-record projections into the core's explicit provider-neutral display input. The resolver evaluates all three sources, collapses matching values, and returns a conflict instead of choosing when they differ. Managed state and managed identifiers come only from publication tables; imported fields may supply external bibliographic links but cannot imply activation. Phase 03 reuses this resolver rather than adding a second activation-specific parser.

Extend the item search projection and public item type with an explicit publication-identifier summary sourced from `publicationIdentifier` and the non-secret provider record IDs needed for links. The display adapter prefers those normalized managed identifiers, detects conflicts with imported metadata, and preserves current external DOI/Zenodo link display without retaining Zotero parsing inside the shared core. Any later identifier settlement must reproject the parent item.

## TDD sequence

1. Add failing schema tests for valid target/identifier/job lifecycles and invalid mixed states.
2. Add failing concurrency tests for namespace allocation, namespace immutability, and duplicate manual activation.
3. Add failing environment-isolation and idempotency tests.
4. Add failing manifest tests for provider dependencies, DOI-safe namespaces, secret requirements, and rejection of production values.
5. Add failing publication-view tests for every display state, precedence rule, current-versus-stale job/receipt handling, capability, retry action, and link rule.
6. Add failing public projection/display-adapter tests for direct-field, Extra-only, attachment-only, matching multi-source, and conflicting DOI inputs; normalized managed identifiers; provider record URLs; and absence of Zotero coupling in the core display API.
7. Implement schema, repositories, runtime accessors, the publication read model, search projection, and the public display-consumer migration.
8. Generate artifacts and make schema checks green.
9. Reset/reseed development data and run focused real-PostgreSQL verification.

## Files touched

- `packages/evidence-library-core/src/schema.ts`
- new `src/db/schema/publication.ts`
- `src/db/database-schema.ts`
- new `src/lib/publication/repository.ts`
- new `src/lib/publication/config.ts`
- new `src/lib/publication/bibliographic-doi.ts`
- new `src/lib/publication/publication-display-adapter.ts`
- new `src/lib/publication/admin-publication-view.ts`
- `src/lib/search-index/projection.ts`, `src/lib/search.ts`, and `src/app/api/item/types.ts`
- `src/components/features/newlib/ItemPage.tsx`
- `src/config/library-config/schema.ts`
- `src/config/library-config/public.ts`
- `config/library.example.json`
- `public/library-config.schema.json`
- `public/library-config.catalogs.json`
- new `tools/verifyPublicationModel.ts`
- `package.json` and `package-lock.json`

## Migration stance

Clean schema addition on disposable development data. No backfill from `item.DOI`: an existing DOI is classified only when an administrator explicitly activates a provider. Reset/reseed if generated fixtures conflict.

## Exact test plan

```sh
npm run schema:generate
npm run schema:check
npm run test:source-model
npm run test:publication-model
npm run test:search-index
npm run test:unit
npx tsc --noEmit
npm run lint
```

`test:publication-model` must use real PostgreSQL and exercise concurrent allocation, target uniqueness, lease bundles, supersession, dead letters, environment isolation, and journal constraints.

## Deployability/runtime gate

- A manifest with test/sandbox credentials validates and loads server-side.
- Public configuration output contains no publication credentials.
- A fresh local database can be initialized and queried with the new schema.
- Public item pages build and retain DOI/Zenodo link behavior through the provider-neutral core display contract.
- No worker starts and no provider is contacted.

## Acceptance criteria

- No provider job can exist without a manually activated target.
- Duplicate activation is idempotent under concurrent requests.
- Crossref suffix allocation is collision-safe and non-recycling.
- Sandbox/test state cannot satisfy another environment.
- Generated artifacts match the typed schema.
- Managed publication identifiers in the public projection come from normalized publication rows, while external imported identifiers remain clearly non-managed.
- A reserved Crossref DOI is immediately present in the canonical item and public projection, while its publication state remains visibly unverified.
- Every admin publication state is derived by one server-side read model, not reimplemented in React.

## Pitfalls

- `item.DOI` alone cannot distinguish external and managed identifiers.
- A JSON blob on the item cannot enforce provider lifecycle or uniqueness.
- Do not expose tokens through the public config projection or health response.
- Do not reuse source-writeback jobs for publication delivery; the retry domains differ.
