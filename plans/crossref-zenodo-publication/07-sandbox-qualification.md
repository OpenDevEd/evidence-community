# 07 — Real sandbox qualification and documentation

## Goal

Prove the complete manually activated publication lifecycle against Crossref test and Zenodo Sandbox, document reproducible operations and evidence, and explicitly stop before production enablement.

## Scope

- Gated real-service verifiers and fixture generation.
- Crossref test and Zenodo Sandbox qualification matrix.
- Full local stack and browser verification.
- Canonical repository documentation and post-push Outline update instructions.
- No production credentials, endpoints, records, or deployment.

## Design

Create unique, traceable test items and DOI suffixes for each run. Provider environment and run ID are included in local receipts. Tests are restartable and reconcile previously created sandbox records instead of blindly duplicating them.

Qualification matrix:

1. Crossref manual activation: success, asynchronous verification, invalid metadata rejection, duplicate click, transient retry, and complete metadata redeposit.
2. Crossref supported-type fixtures: one verified test deposit for every mapper family, not necessarily every aliasing Evidence Library item type.
3. Zenodo `reuse-crossref`: wait for Crossref, wait for PDF, create/upload/publish, metadata edit, permitted minor file correction, and out-of-policy file-change attention.
4. Zenodo `mint-zenodo`: no-Crossref activation, version/concept DOI settlement, metadata edit, file-change new version, and dual-provider Crossref relation update.
5. Recovery: terminate after Crossref submit, after Zenodo draft journal, during upload, and after remote publish response loss.
6. Reconciliation: missed enqueue, unchanged no-op, provider drift, pending verification, dead letter and retry.
7. Source boundary: native and Zotero-linked items behave identically for provider publication; Zotero changes only when ordinary source writeback is enabled.
8. UI: manual controls, persisted progress, reload, human errors, links, retries, responsive layout, dark/light themes, and computed CSS.
9. Isolation: test/sandbox rows and credentials cannot be interpreted as production.

Store sanitized test evidence as machine-readable run summaries and concise documentation. Do not store tokens.

## TDD sequence

1. Add explicit environment-gated commands that fail closed when required test credentials are absent.
2. Add deterministic fixture creation and run-ID naming.
3. Execute the MEE worker's existing `npm run smoke:sandbox` command as a baseline for the shared core/provider clients; the core itself has no live smoke runner.
4. Execute each Evidence Library real-service scenario and fix behavior in its owning phase rather than weakening expectations.
5. Run full local browser verification with real persisted progress.
6. Run the complete regression suite.
7. Update repository documentation to match verified behavior.
8. Commit and push only with explicit authorization; read back remote SHAs.
9. Update and re-read the smallest canonical Outline pages after push.

## Files touched

- new `tools/verifyCrossrefTestPublication.ts`
- new `tools/verifyZenodoSandboxPublication.ts`
- new `tools/verifyPublicationSandboxLifecycle.ts`
- `package.json`
- `tests/acceptance/compose.yaml`, `tests/acceptance/fixture/publication-provider-fake.mjs`, `tests/e2e/admin-publication.spec.ts`, and `playwright.config.ts`
- `docs/publication-sync.md`
- `docs/evidence-library-operations.md`
- `docs/evidence-library-customization-map.md`
- `docs/admin-item-list.md`
- `config/library.example.json` and generated artifacts if final verified constraints changed
- `../mee/doi-sync-core/README.md`
- `../mee/mee-doi-sync-worker/README.md` and `DECISIONS.md` for the updated shared API

## Migration stance

Sandbox/test data is disposable but identifiers are not silently reused. Cleanup removes local fixtures and unpublished Zenodo drafts only; published sandbox records and Crossref test identifiers remain as auditable test artifacts.

## Exact test plan

```sh
# Shared projects
(cd ../mee/doi-sync-core && npm run verify)
(cd ../mee/mee-doi-sync-worker && npm run verify)

# Evidence Library
npm run schema:check
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:acceptance
npm run test:publication-model
npm run test:crossref-activation
npm run test:zenodo-activation
npm run test:publication-worker
npm run test:crossref-test-live
npm run test:zenodo-sandbox-live
npm run test:publication-sandbox-lifecycle
npm run test:acceptance
git diff --check
```

## Deployability/runtime gate

- Every qualification scenario has a terminal machine-readable result and provider identifiers.
- Crossref test records are verified through deposit diagnostics and the applicable test metadata lookup.
- Zenodo Sandbox records are re-read and checksums/identifiers match local settled state.
- Browser progress is backed by the same rows and receipts used by the worker.
- Production environments are still rejected by configuration.

## Acceptance criteria

- The entire matrix passes on two consecutive fresh runs.
- Restart and reconciliation scenarios produce no duplicate active identities.
- Documentation commands run exactly as written.
- Git contains only intended files and all repositories are green.
- After authorized push, remote SHAs are read back and Outline Current decisions, Architecture/data ownership, Evidence Library current state, and Development runbooks are updated only where the verified work changes their canonical truth.
- A separate reviewed plan is required to introduce production environment values or credentials.

## Pitfalls

- Zenodo Sandbox may be reset; local recovery must distinguish missing sandbox data from production semantics.
- Crossref test indexing timing is asynchronous and must not be replaced by arbitrary sleeps.
- Provider rate limits require bounded polling and unique fixtures.
- Do not update the deployed-production architecture snapshot until a real deployment is verified.
