# Execution prompts

Use one prompt at a time. Re-read `AGENTS.md`, the phase plan, current code, and current primary provider documentation before editing. Each phase is committed as green logical units; pushing and provider writes require separate authorization.

## 01 — Provider-neutral DOI sync core

```text
Implement plans/crossref-zenodo-publication/01-provider-neutral-core.md. Verify both shared repositories are on their existing `openscholar` branches at the recorded base revisions; never edit or commit this work on `main`. Work first in OpenDevEd/doi-sync-core, then update OpenDevEd/mee-doi-sync-worker to the exact new core commit. Follow DRY and red-green-refactor. Replace the Zotero-shaped core API cleanly across src/zotero, doi, ports, preparation, intended-diff, display, metadata-audit, metadata, files, planner, and executors; do not add compatibility aliases. Keep DOI normalization and display-link construction in core with explicit provider-neutral inputs because the Evidence Library public item page is an active consumer; move Extra parsing, attachment-tag parsing, Zotero source labels, drift handling, and writeback to adapters. Preserve provider recovery, retries, and settlement. Replace MD5/mtime file hashing with size/SHA-256. Upgrade Crossref output to schema 5.5.0 with explicit item-type mappers and official-XSD fixtures. Make Crossref and Zenodo independent targets and allow mint-zenodo without Crossref. Run both npm run verify suites. Do not call live providers, push, or update Outline.
```

## 02 — Publication state and configuration

```text
Implement plans/crossref-zenodo-publication/02-publication-state-and-config.md in new-el on branch openscholar. Reuse existing Evidence Library lease, job, run, dead-letter, file-publication, manifest, and runtime-config primitives. Add normalized publication target/identifier/state/job/journal/run and DOI namespace tables in the dedicated src/db/schema/publication.ts module with strict PostgreSQL constraints and environment isolation. Add one buildAdminPublicationView read model that derives every admin display state and capability from durable rows plus the pure core planner; do not persist or rederive display status elsewhere. Advance the active core display dependency to exact commit 9816cde6f80e02c45ecd9242b03c1f2e3f1c698e and atomically migrate ItemPage through a shared Evidence Library bibliographic DOI resolver and display adapter. Add server-only Crossref test and Zenodo Sandbox configuration. The Crossref-assigned prefix and per-library suffix namespace must be server-owned and the namespace immutable after first reservation. Production values must be invalid. Generate configuration artifacts. Use real PostgreSQL for the new publication-model verifier. Do not add admin routes, new UI, provider calls, compatibility columns, production values, pushes, or Outline updates.
```

## 03 — Manual Crossref activation

```text
Implement plans/crossref-zenodo-publication/03-crossref-activation.md. Crossref activation must be an explicit per-item admin action and the only way to create a Crossref publication target. Reuse the phase-02 resolver to normalize DOI from item.DOI, Zotero-style extra, and DOI link attachments tagged _r:doi before allocation; matching values collapse, conflicts block, and an existing DOI in any source must never mint a duplicate. Validate public parent state, supported Crossref 5.5 item type, required metadata, stable landing URL, test configuration, and DOI ownership. The browser must not submit a prefix, suffix, counter, or DOI. Atomically reserve a non-recycled DOI from the server-configured prefix/namespace only when no resolved DOI exists, write it immediately to canonical item.DOI, increment the revision, create the target/identifier/job/receipt, and queue the search outbox plus ordinary configured source writeback. Return the exact reserved DOI immediately but keep its lifecycle reserved/in progress until Crossref verification. Verification enqueues exactly one search reprojection but no second item revision or source-writeback job. Manual retry resets the latest dead-lettered job to due while preserving attempt history. Add the named provisional one-shot runner for local phase-03/04 verification. Implement Crossref test planning/execution/pending verification through doi-sync-core. Use provider fakes in normal tests; do not call real Crossref yet. Run every listed focused test. Do not implement Zenodo or UI, push, or update Outline.
```

## 04 — Manual Zenodo activation

```text
Implement plans/crossref-zenodo-publication/04-zenodo-activation.md. Zenodo activation must be a separate explicit per-item admin action. Default to reuse-crossref; allow explicit mint-zenodo. A reserved managed Crossref DOI may activate a Zenodo target, but it waits locally for Crossref verification. If only an external bibliographic DOI exists, server validation advertises no allowed policy and blocks activation so the system cannot mint a duplicate DOI. Persist policy and make it immutable after first publish. Keep fileless targets locally waiting_for_file without creating remote drafts. Read only current published Evidence Library files from configured storage and verify SHA-256. Implement crash-safe draft/upload/publish/recovery and correct metadata/file version behavior through doi-sync-core with provider fakes. Sandbox is the only representable environment. Run every listed focused test. Do not add nightly scheduling or final UI, call real Zenodo, push, or update Outline.
```

## 05 — Durable delivery and reconciliation

```text
Implement plans/crossref-zenodo-publication/05-worker-and-reconciliation.md. Add one long-running Evidence Library publication worker using the library PostgreSQL and storage. Reuse source-writeback/search worker lease, heartbeat, retry, dead-letter, supersession, and receipt patterns. Enqueue immediate work only for manually activated targets when relevant canonical metadata or published files change. Add a leased nightly keyset reconciliation scan of activated targets only. Read current canonical state at execution and prevent stale revisions from settling. Expose real worker health and exact receipts. Delete the provisional tools/runPublicationJobsOnce.ts runner when this worker replaces it. Run every listed focused test with real PostgreSQL and fake providers. Do not call real providers, push, or update Outline.
```

## 06 — Admin publication UI

```text
Implement plans/crossref-zenodo-publication/06-admin-publication-ui.md. Read the installed Next.js 16 documentation before changing route/client behavior. Add DOI publishing as the first scrollable section in AdminInspector, with two compact provider rows and no separate page. Render the phase-02 AdminPublicationView directly, including its repair_pending state and server-advertised policy capabilities; do not recreate validation or Zenodo policy rules in React. Use SWR for server-directed conditional polling and mutation invalidation; local state may only hold confirmation visibility and the unsaved Zenodo policy choice. Crossref confirmation shows the configured prefix/namespace preview, never accepts DOI parts, and shows the exact DOI returned after reservation immediately as Reserved until verification. Zenodo confirmation offers Use the Crossref DOI or Create a Zenodo DOI too only when the server allows each policy, and locks the saved policy after first publish. Reuse the existing attachment section for missing-file work. Test semantics and ARIA, not class strings. Run the full local stack and verify every state visually in a real browser, including computed CSS, screenshots, keyboard behavior, narrow widths, dark mode, and light mode. Do not call real providers, push, or update Outline.
```

## 07 — Sandbox qualification and documentation

```text
Implement plans/crossref-zenodo-publication/07-sandbox-qualification.md. Use only Crossref test and Zenodo Sandbox. Use the MEE worker smoke:sandbox command as the shared-client baseline; the core has no live smoke runner. Build fail-closed, environment-gated Evidence Library real-service verifiers and execute the complete matrix for manual activation, supported mapper families, both Zenodo policies, files, metadata, retries, crash recovery, reconciliation, native/source-linked boundaries, environment isolation, and persisted UI progress. Fix defects in their owning layer; do not weaken tests or use arbitrary success timers. Run all shared-core, MEE-worker, Evidence Library, real-service, acceptance, and Playwright checks listed in the phase. Update canonical repository docs only with verified behavior. Do not introduce production configuration, deploy, push, or update Outline without explicit authorization.
```

## 08 — Current-branch integration and docs-pen canary

```text
Read plans/crossref-zenodo-publication/08-openscholar-integration-and-docs-pen-canary.md, plans/crossref-zenodo-publication/00-README.md, and plans/crossref-zenodo-publication/07-sandbox-qualification.md. This is a multi-hour integration, test, and development deployment. Keep working through the complete plan without asking questions whose answers are already in those files.

STANDING RULES
1. Reuse the current tenant Compose, admin services, publication modules, worker helpers, fake provider, and runtime tools before adding anything.
2. Make clean breaking changes. Do not restore Tailscale, add compatibility fields, or keep both old and new migration paths.
3. Read installed Next.js route-handler documentation before editing app routes. Do not add useEffect for app state.
4. Use behavior tests at the admin view, activation API, unpublish API, migration/runtime, real provider lifecycle, and tenant-isolation seams. Never test Tailwind classes.
5. Use current official Crossref and Zenodo docs and the installed doi-sync-core source. Do not guess provider behavior.
6. Provider writes are allowed only against Crossref Test and Zenodo Sandbox for docs-pen after the disabled deployment is healthy. Production and the other library are out of scope.
7. Use GPT-5.6 Sol for delegated agents. Have Fable 5 review this plan before implementation and review the completed major step after all local checks pass.

EXECUTION RHYTHM
- Commit this plan before code.
- For DOI preview, ownership, and unpublish safety, write one failing behavior test, make it pass, and commit each green unit.
- Resolve integration conflicts by preserving the current openscholar behavior and adding only the publication concern.
- Run focused checks after each unit, then the complete local gate before any push.
- Deploy disabled first, verify, then enable sandbox configuration and run the real lifecycle.

COMMIT DISCIPLINE
- Use conventional commit prefixes and add `[plan-08]` to every plan-08 commit.
- Stage named files only. Never commit failing work.
- Push only after the complete local gate passes, then read back the remote SHA.

WHEN TO STOP
- Stop only for a missing required API, a provider result that cannot be safely retried, or a migration failure that requires deleting data outside the authorized docs-pen development scope.
- Do not stop for conflict volume, long tests, token worry, or an answer already fixed in the plan.
- Do not report completion until the exact Coolify deployment is finished, all six runtime services are healthy, and the real sandbox lifecycle is verified.

DEVIATIONS
- If the plan is wrong but the safe path is clear, commit safe work, update this numbered plan, commit `docs: [plan-08] revise <section> — <reason>`, then continue.
- If a required API is missing, commit safe work, add `plans/crossref-zenodo-publication/08-BLOCKER.md`, and stop without a workaround.

START NOW
- Read the three plan files, AGENTS.md, current git status, current branch tips, installed Next.js route-handler docs, and the pinned DOI core source.
- Confirm the worktree is clean and begin with the plan commit and Fable 5 plan review.
- Then start the first red test.

Go.
```
