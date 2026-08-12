# 01 — Provider-neutral DOI sync core

## Goal

Replace the Zotero-shaped shared engine with a provider-neutral publication engine, upgrade Crossref output to schema 5.5.0, and leave both the core and MEE adapter green without a legacy API facade.

## Scope

- Repository: `OpenDevEd/doi-sync-core`, branch `openscholar` from `895f2f67bba36b62a443424004cd9bd15c13e7d1`.
- Coordinated consumer update: `OpenDevEd/mee-doi-sync-worker`, branch `openscholar` from `778ef3ca1eaa07b3767d898c2f3da96fbd000227`.
- Pure canonical metadata and file inputs.
- Independent Crossref and Zenodo targets.
- Explicit Crossref and Zenodo type mappers.
- Existing provider clients, recovery, hashing, retries, and settlement retained and extended.

Out of scope: Evidence Library database schema, routes, UI, scheduler, and live provider writes.

## Design

Introduce discriminated, provider-neutral types:

- `PublicationRecordSnapshot`: stable item key, canonical revision, title, dates, creators, abstract, language, publisher/institution, rights/license, tags, public landing URL, and item-type-specific fields.
- `PublicationFileManifest`: stable file key, publication revision, filename, MIME type, size, SHA-256, and a byte-reader port outside pure planning.
- `PublicationIdentifiers`: optional external DOI, managed Crossref DOI, Zenodo version DOI, and Zenodo concept DOI.
- `PublicationTargetPolicy`: independently enabled Crossref and Zenodo targets plus Zenodo identifier policy.
- `ProviderSyncState`: environment-scoped last-success snapshots, pending verification, external IDs, journal state, and failures.

Remove Zotero from the planner, hashes, operations, and executor context. Move Zotero normalization, DOI candidate extraction/drift analysis, managed-Extra parsing, and file selection into an explicit MEE adapter. Remove core `zotero_writeback` operations; MEE performs its own post-settlement writeback adapter, while Evidence Library uses its existing source-writeback jobs.

Keep `normalizeDoi` and DOI/display link construction in the core as provider-neutral utilities because the Evidence Library public item page is an active consumer. Refactor `src/doi.ts` so its public inputs and source labels contain no Zotero fields. Refactor `src/display.ts` to accept explicit bibliographic, Crossref, Zenodo version/concept, and provider-record identifiers; it must not parse Zotero `extra`, attachment tags, or import `src/zotero/writeback.ts`. The MEE adapter and the Evidence Library adapter each map their own source data into that explicit display contract.

Split planning into independently composable target plans so Zenodo can be activated without Crossref. Crossref-to-Zenodo relations are emitted only when both identifiers exist and the Zenodo policy is `mint-zenodo`.

Replace the single report XML builder with a discriminated Crossref 5.5 mapper. Each supported type generates a schema-valid fixture. Unsupported or insufficiently described items return structured validation issues before any operation is planned.

Replace the hard-coded Zenodo publication/report mapping with the documented controlled vocabulary. Current file snapshots already exclude source version counters but depend on MD5 and mtime. Replace those inputs with stable identity plus bytes/metadata (`fileKey`, filename, MIME type, size, SHA-256), so mtime-only and provider-version-only changes do not schedule writes while byte changes do.

## TDD sequence

1. Add failing public-API tests for provider-neutral publication inputs, DOI normalization/source labels, explicit display identifiers, and independent targets; prove the display module has no Zotero import.
2. Add failing hash tests for the actual change: identical size/SHA-256 with different MD5, mtime, and source revision does not schedule a write; changed SHA-256 does.
3. Add table-driven failing tests for every supported Crossref mapping and every blocked item type.
4. Add XSD validation fixtures for every generated Crossref 5.5 document.
5. Add table-driven Zenodo vocabulary tests, including `reuse-crossref`, Crossref-independent `mint-zenodo`, and dual-provider relations.
6. Refactor planner, snapshots, operations, executor, recovery, and settlement to make the tests green.
7. Add an MEE adapter that maps Zotero parent/children into the new model and owns Zotero writeback.
8. Update `mee-doi-sync-worker` to the new API and remove the superseded core Zotero types/operations.
9. Refactor and run both full verification suites.

## Files touched

Core existing donors:

- `src/metadata.ts`, `src/files.ts`, `src/planner.ts`, `src/operations.ts`
- `src/doi.ts`
- `src/ports.ts`, `src/preparation.ts`, `src/intended-diff.ts`, `src/display.ts`, `src/metadata-audit.ts`
- every module and test under `src/zotero/`, including `src/zotero/writeback.ts`
- `src/snapshots.ts`, `src/settlement.ts`, `src/live-settlement.ts`
- `src/executor/live-executor.ts`, `src/executor/dry-run-executor.ts`
- `src/crossref/xml.ts`, `src/crossref/client.ts`, `src/crossref/contributors.ts`
- `src/zenodo/records.ts`, `src/zenodo/doi-policy.ts`, `src/zenodo/client.ts`
- `src/zenodo/journal.ts`, `src/zenodo/state-hints.ts`, `src/recovery.ts`
- `src/index.ts`, `README.md`, and corresponding tests

Expected new core modules:

- `src/publication/record.ts`
- `src/publication/files.ts`
- `src/publication/targets.ts`
- `src/crossref/record-mapper.ts`
- `src/zenodo/resource-mapper.ts`

MEE consumer:

- `package.json`, `package-lock.json`, `src/record.ts`, `src/worker.ts`, `src/app.ts`
- new `src/adapters/zotero-publication-adapter.ts`
- every current import or adapter that consumes core Zotero preparation, Extra parsing, intended-diff, display, metadata-audit, file-selection, or `zotero_writeback` behavior
- worker tests, README, and `DECISIONS.md`

## Migration stance

Breaking package API. Delete the old Zotero-shaped planner and `zotero_writeback` operation when the MEE adapter is updated. Publish/export the new provider-neutral DOI/display contract for the Evidence Library, which remains pinned to the old working commit until phase 02 migrates it atomically. Do not provide deprecated aliases or dual behavior.

## Exact test plan

```sh
# doi-sync-core
npm run verify

# mee-doi-sync-worker after pinning the exact core revision
npm run verify
ORG_SCOPE=none node dist/main.js run-once
```

Additionally validate every Crossref fixture against the official 5.5.0 XSD and assert serialized payloads rather than implementation classes.

## Deployability/runtime gate

- Both repositories are clean and green on exact commits.
- Both repositories remain on their `openscholar` branches; neither `main` branch receives these commits.
- MEE dry-run composition succeeds with zero provider writes.
- No Evidence Library dependency is advanced until the MEE adapter and the provider-neutral DOI/display exports pass. The Evidence Library's active public-page consumer is migrated explicitly in phase 02.

## Acceptance criteria

- Core planning has no Zotero-required fields.
- Core DOI normalization and display construction have no Zotero source labels, Extra parsing, attachment-tag parsing, or imports from `src/zotero/`.
- Crossref and Zenodo can be enabled independently.
- Every supported Crossref type validates under schema 5.5.0.
- No item silently falls back to report.
- `mint-zenodo` works without a Crossref DOI.
- Provider hashes are stable across irrelevant source revision changes.
- Existing Crossref pending verification, Zenodo journal recovery, retry, and settlement behavior remains covered.

## Pitfalls

- Crossref metadata updates overwrite omitted fields; snapshots and XML must remain complete.
- Crossref relationship replacement may require explicit clearing before redeposit.
- Zenodo's same-record file correction is not general versioning and must not be modeled as such.
- Updating only the core without the MEE adapter would leave a broken consumer.
