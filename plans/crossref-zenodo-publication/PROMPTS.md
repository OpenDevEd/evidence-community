# Execution prompts

Use one prompt at a time. Re-read `AGENTS.md`, the phase plan, current code, and current primary provider documentation before editing. Each phase is committed as green logical units; pushing and provider writes require separate authorization.

## 01 — Provider-neutral DOI sync core

```text
Implement plans/crossref-zenodo-publication/01-provider-neutral-core.md. Verify both shared repositories are on their existing `openscholar` branches at the recorded base revisions; never edit or commit this work on `main`. Work first in OpenDevEd/doi-sync-core, then update OpenDevEd/mee-doi-sync to the exact new core commit. Follow DRY and red-green-refactor. Replace the Zotero-shaped core API cleanly across src/zotero, doi, ports, preparation, intended-diff, display, metadata-audit, metadata, files, planner, and executors; do not add compatibility aliases. Keep DOI normalization and display-link construction in core with explicit provider-neutral inputs because the Evidence Library public item page is an active consumer; move Extra parsing, attachment-tag parsing, Zotero source labels, drift handling, and writeback to adapters. Preserve provider recovery, retries, and settlement. Replace MD5/mtime file hashing with size/SHA-256. Upgrade Crossref output to schema 5.5.0 with explicit item-type mappers and official-XSD fixtures. Make Crossref and Zenodo independent targets and allow mint-zenodo without Crossref. Run both npm run verify suites. Do not call live providers, push, or update Outline.
```

## 02 — Publication state and configuration

```text
Implement plans/crossref-zenodo-publication/02-publication-state-and-config.md in new-el on branch openscholar. Reuse existing Evidence Library lease, job, run, dead-letter, file-publication, and manifest primitives. Add normalized publication target/identifier/state/job/journal/run and DOI namespace tables in the dedicated src/db/schema/publication.ts module with strict PostgreSQL constraints and environment isolation. Advance the active core display dependency to the exact verified phase-01 commit and atomically migrate ItemPage through a shared Evidence Library bibliographic DOI resolver and display adapter that parse imported Zotero-style fields locally while managed identifiers come from normalized publication rows and the search projection; phase 03 must reuse the same resolver. Add server-only Crossref test and Zenodo Sandbox configuration; production values must be invalid. Generate configuration artifacts. Use real PostgreSQL for the new publication-model verifier. Do not add admin routes, new UI, provider calls, compatibility columns, production values, pushes, or Outline updates.
```

## 03 — Manual Crossref activation

```text
Implement plans/crossref-zenodo-publication/03-crossref-activation.md. Crossref activation must be an explicit per-item admin action and the only way to create a Crossref publication target. Reuse the phase-02 resolver to normalize DOI from item.DOI, Zotero-style extra, and DOI link attachments tagged _r:doi before allocation; matching values collapse, conflicts block, and an existing DOI in any source must never mint a duplicate. Validate public parent state, supported Crossref 5.5 item type, required metadata, stable landing URL, test configuration, and DOI ownership. Atomically reserve a non-recycled human-readable DOI only when no resolved DOI exists, mutate canonical state, queue publication, search outbox, and ordinary configured source writeback, and return an exact receipt. Implement Crossref test planning/execution/pending verification through doi-sync-core. Use provider fakes in normal tests; do not call real Crossref yet. Run every listed focused test. Do not implement Zenodo or UI, push, or update Outline.
```

## 04 — Manual Zenodo activation

```text
Implement plans/crossref-zenodo-publication/04-zenodo-activation.md. Zenodo activation must be a separate explicit per-item admin action. Default to reuse-crossref; allow explicit mint-zenodo. Persist policy and make it immutable after first publish. Keep fileless targets locally waiting_for_file without creating remote drafts. Read only current published Evidence Library files from configured storage and verify SHA-256. Implement crash-safe draft/upload/publish/recovery and correct metadata/file version behavior through doi-sync-core with provider fakes. Sandbox is the only representable environment. Run every listed focused test. Do not add nightly scheduling or final UI, call real Zenodo, push, or update Outline.
```

## 05 — Durable delivery and reconciliation

```text
Implement plans/crossref-zenodo-publication/05-worker-and-reconciliation.md. Add one long-running Evidence Library publication worker using the library PostgreSQL and storage. Reuse source-writeback/search worker lease, heartbeat, retry, dead-letter, supersession, and receipt patterns. Enqueue immediate work only for manually activated targets when relevant canonical metadata or published files change. Add a leased nightly keyset reconciliation scan of activated targets only. Read current canonical state at execution and prevent stale revisions from settling. Expose real worker health and exact receipts. Run every listed focused test with real PostgreSQL and fake providers. Do not call real providers, push, or update Outline.
```

## 06 — Admin publication UI

```text
Implement plans/crossref-zenodo-publication/06-admin-publication-ui.md. Read the installed Next.js 16 documentation before changing route/client behavior. Add a compact Publication section to AdminInspector with separate manual Crossref and Zenodo activation, default reuse-crossref and explicit mint-zenodo choice, durable progress, human validation, retry, copy, and open actions. Use SWR for polling/mutation invalidation; do not use effects for state synchronization or polling. Test semantics and ARIA, not class strings. Run the full local stack and verify every state visually in a real browser, including computed CSS, screenshots, keyboard behavior, narrow widths, dark mode, and light mode. Do not call real providers, push, or update Outline.
```

## 07 — Sandbox qualification and documentation

```text
Implement plans/crossref-zenodo-publication/07-sandbox-qualification.md. Use only Crossref test and Zenodo Sandbox. Use the MEE worker smoke:sandbox command as the shared-client baseline; the core has no live smoke runner. Build fail-closed, environment-gated Evidence Library real-service verifiers and execute the complete matrix for manual activation, supported mapper families, both Zenodo policies, files, metadata, retries, crash recovery, reconciliation, native/source-linked boundaries, environment isolation, and persisted UI progress. Fix defects in their owning layer; do not weaken tests or use arbitrary success timers. Run all shared-core, MEE-worker, Evidence Library, real-service, acceptance, and Playwright checks listed in the phase. Update canonical repository docs only with verified behavior. Do not introduce production configuration, deploy, push, or update Outline without explicit authorization.
```
