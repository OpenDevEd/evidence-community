# 04 — Manual Zenodo activation

## Goal

Implement a separate idempotent administrator opt-in for Zenodo Sandbox using `reuse-crossref` by default or explicit `mint-zenodo`, with published-file gating and crash-safe publication.

## Scope

- Zenodo activation/status/retry API contracts.
- Evidence Library metadata and storage adapters.
- Draft, upload, publish, identifier settlement, metadata edit, and version behavior.
- No nightly scanner or final UI.

## Design

Add routes:

- `POST /api/admin/items/[key]/publication/zenodo/activate`
- `POST /api/admin/items/[key]/publication/zenodo/retry`

The activation request may specify `mint-zenodo`; omission uses the manifest default `reuse-crossref`.

Rules:

- `reuse-crossref` requires the item's activated managed Crossref DOI. It may be selected while that DOI is reserved, but the Zenodo target remains locally waiting until Crossref verifies it. External bibliographic DOIs do not satisfy this option.
- `mint-zenodo` works independently and reserves/mints Zenodo identifiers through the provider.
- If the item already has an external bibliographic DOI and no managed Crossref target, server-side activation validation blocks both policies in this version. Do not mint a duplicate Zenodo DOI and do not broaden the shared core contract inside the Evidence Library adapter. The status contract therefore advertises no allowed Zenodo policy and the UI only renders that capability.
- No published file produces durable `waiting_for_file`. Publishing a file later queues the existing activated target automatically.
- File bytes come only from current `itemFilePublication` rows and configured storage. SHA-256 and size are checked before upload.
- The selected policy is persisted at activation and becomes immutable after first publish.
- Metadata edits update the published record.
- `mint-zenodo` file changes create a new version and preserve concept/version identifiers.
- `reuse-crossref` file correction follows Zenodo's documented minor-correction window and the sandbox-proven Invenio flow. Outside that policy, the target becomes `needs_attention`; it does not mutate history or silently switch policy.
- A prepared draft is journaled transactionally before publish. Restart recovery verifies provider state before retrying any irreversible action.
- Settling a Zenodo version DOI, concept DOI, or public record ID enqueues the parent item's search outbox event in the same transaction so public identifier links come from normalized publication state.

Map all supported Evidence Library parent types to Zenodo's documented controlled vocabulary. Child attachments, notes, and annotations are not independently activated in this phase.

## TDD sequence

1. Add policy tests for defaulting, explicit minting, immutable published policy, Crossref dependency, and external-DOI duplicate prevention.
2. Add type-mapper tests against Zenodo's controlled vocabulary.
3. Add file-adapter tests for published-only selection, checksum, missing bytes, and filename conflict.
4. Add route tests for duplicate activation and `waiting_for_file`.
5. Add provider-fake tests for draft/create/upload/publish, publish timeout recovery, duplicate DOI recovery, metadata edit, new version, minor-correction rejection, and transactional parent reprojection when identifiers settle.
6. Implement adapters, routes, state settlement, and journal recovery.
7. Add local full-stack verifier with fake Zenodo and real PostgreSQL/storage emulator.

## Files touched

- new `src/lib/publication/zenodo-activation-service.ts`
- new `src/lib/publication/zenodo-adapter.ts`
- new `src/lib/publication/publication-file-adapter.ts`
- new Zenodo API routes under `src/app/api/admin/items/[key]/publication/`
- `src/lib/admin/file-storage.ts`, `file-runtime.ts`, and `file-projection.ts` only through reusable read ports
- `src/lib/search-index/projection.ts` only at the normalized publication-identifier read seam
- new `tools/verifyZenodoActivation.ts`
- focused unit, storage, HTTP, and recovery tests
- `package.json`

## Migration stance

No import of MEE's `zenodoRecordID` or Zotero Extra fields. Provider recovery uses exact environment-scoped DOI/record lookups and journal state.

## Exact test plan

```sh
npm run test:publication-model
npm run test:zenodo-activation
npm run test:search-index
npm run test:file-storage
npm run test:native-file-lifecycle
npm run test:native-file-http
npm run test:unit
npx tsc --noEmit
npm run lint
```

## Deployability/runtime gate

- Local fake-provider flows survive a process stop after draft preparation and after publish timeout.
- File uploads are read from the same storage objects served by the Evidence Library.
- Sandbox is the only accepted environment.
- No empty Zenodo record is created for a fileless item.

## Acceptance criteria

- Nothing touches Zenodo until manual activation.
- Repeated activation returns the same target.
- `reuse-crossref` is the default and its dependency is visible in state.
- `mint-zenodo` works without Crossref and settles both version and concept DOI.
- An external bibliographic DOI cannot accidentally produce a duplicate Zenodo DOI.
- File changes follow the locked policy without silent identity changes.
- Every remote mutation is recoverable or ends in a durable actionable state.
- Newly settled Zenodo links appear through a real parent search reproject, not optimistic UI state.

## Pitfalls

- Zenodo recommends using an existing DOI only when the deposit is the same work.
- Minor same-record file correction is time- and purpose-limited; it is not nightly versioning.
- Publishing can succeed remotely while the client times out; always reconcile before retrying.
- A Sandbox token and production token address different accounts and records.
