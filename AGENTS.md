## Ultimate rules

1. **DRY first.** Before implementing anything, search the repository for an existing component, service, schema primitive, adapter, worker, fixture, verifier, or documentation contract that can be extended or repurposed.
2. **Research before guessing.** Words such as "likely", "possible", "probably", and "I think" are a stop signal. Use the `find-skills` skill, the relevant installed skill, primary/current documentation, library source, and web research before deciding.
3. **No legacy compatibility.** This branch is pre-testing. Prefer clean breaking changes, delete obsolete paths, and leave no dead code, dual behavior, compatibility shims, or speculative fallbacks unless the user explicitly changes this rule.
4. **Do not derail work over secrets.** The user accepts environment values appearing in agent history and terminal output. Do not rotate keys, lecture about exposure, or add redaction work unless requested.

## Product identity and repository boundary

This repository is the **Evidence Library runtime** for the combined OpenScholar product. It owns:

- the public evidence-library website;
- record-and-metadata administration under `/admin`;
- canonical library records, drafts, revisions, tombstones, collections, and files;
- runtime library manifests and activation/rollback;
- PostgreSQL-to-Meilisearch projection;
- source ingestion and orchestration;
- Zotero Sync and Zotero Writeback; and
- durable background workers, retries, leases, dead letters, and delivery receipts.

OpenScholar is developed in `OpenDevEd/openalex-count` on branch `dev`. It owns research discovery, literature-review workflow, screening, extraction, synthesis, research organization, user subscriptions/billing, and the future control-plane and publish-entry experience. Do not recreate those research workflows here. The repositories meet through an explicit authenticated, versioned, idempotent publish/provisioning contract.

Active development branch for this repository: `openscholar`.

## Outline knowledge base — required project context

The shared durable knowledge base is the **OpenScholar** collection in Outline.

- Collection ID: `16480726-288c-42f7-9912-5047444585c9`
- Start document: **00 — Start Here: OpenScholar Agent Map**
- Start document ID: `cc243a51-87ec-4137-869e-0e791f6161f4`
- Evidence Library current state: `57d9f73d-4fce-430d-b0ad-da11903141b6`
- Product boundaries: `ff5168e3-7289-42b2-a3e4-a07401fcfce1`
- Integration contract: `ff15f65c-bf85-48b3-baf5-e849f85cde41`
- Architecture and data ownership: `c5a528cb-ae33-4282-96d6-a3fa28036709`
- Current decisions: `636ce019-6fe6-4a4e-918b-95e0912cc92d`
- Development runbooks: `30b7169b-1530-424a-a374-80478d1bee56`
- Knowledge-base protocol: `81d7111b-d75c-46d2-9229-e1eb44934195`

At the start of product, architecture, roadmap, or cross-repository work:

1. Confirm the Outline MCP server is connected.
2. Read the Start document by ID.
3. Read the Evidence Library current-state page.
4. Read only the additional pages relevant to the task.
5. Cross-check implementation and deployment claims against this branch, tests, real-service verifiers, and the live runtime.

If Outline is unavailable, continue only when repository-local context is sufficient and explicitly report that the knowledge base could not be read or updated. Never claim an MCP write succeeded without re-reading it.

## Knowledge-base write requirement

Outline must track durable shared truth, not every commit. After an authorized change is verified and pushed, update the smallest canonical Outline page when the work changes:

- a product or architecture decision;
- repository ownership or a cross-repository contract;
- actual implementation status;
- a supported development or operational workflow;
- deployment topology; or
- roadmap interpretation.

Search before creating a page. Update the canonical document instead of creating duplicates. Record the date, repository, branch, commit, and verification evidence. Preserve superseded decisions and their rationale. Do not document uncommitted experiments or let Outline get ahead of Git.

## Authority and current-state rules

When sources conflict, use this order:

1. the user's current explicit instruction;
2. active branch code, tests, committed history, and verified runtime;
3. current Outline decisions;
4. the applicable product roadmap;
5. delivery plans, prototypes, transcripts, historical audits, and superseded material.

The `openscholar` branch and its commit history are authoritative for current development progress. The WIP/design roadmap was an input for milestone creation, not a progress tracker. A previous `main`-only zero-baseline rule applied to a GitHub planning exercise and must not erase real branch implementation.

Zotero Sync and Zotero Writeback are implemented here. Collection-membership writeback, source collection management, and drag/bulk membership flows are also implemented. Inspect the current code before planning; never add “implement Zotero writeback” as untouched future work.

The BeeWriter `roadmap.qmd` remains the Evidence Library/self-service product roadmap despite its obsolete callout; the user explicitly rejected that callout. In that roadmap, the “subscription website” is OpenScholar. `roadmap-v2.qmd` is a narrower Discover-to-Publish pilot programme and does not replace the broader product roadmap.

## Next.js and React rules

This repository uses Next.js 16 and React 19. Read the relevant guide under `node_modules/next/dist/docs/` before changing Next.js APIs, conventions, caching, routing, request behavior, or file structure.

Do not use `useEffect`, `useLayoutEffect`, or `useInsertionEffect` for application-state synchronization, prop mirroring, derived state, URL state, data fetching, mutation triggers, filters, tabs, pagination, modal state, or form mirroring. Use Server Components, route handlers/loaders, SWR where already established, `nuqs`, derived render values, lifted state, context, and event handlers.

Effects are allowed only for genuine external browser/DOM systems that require setup and teardown, such as event listeners, observers, timers, or imperative third-party widgets. Keep them in the smallest leaf component or custom hook with complete cleanup and exhaustive dependencies.

## Architecture invariants

### Canonical state

- PostgreSQL is canonical. Meilisearch is derived and disposable.
- Public item state changes only through explicit publication/unpublication/restore flows.
- Drafts are private intent; they are not public canonical rows.
- Tombstoned identities are retained and are not silently recycled.
- File draft state and file publication state are distinct.
- Canonical revisions, normalized relations, outbox events, and required writeback jobs commit transactionally.

### Search delivery

- The outbox indexer reads current canonical state; it does not reconstruct historical payloads.
- A Meilisearch request is not success until its asynchronous task reaches terminal `succeeded`.
- Entity leases and serialization must prevent older revisions from overwriting newer projections.
- Child attachment events reproject their parent; collection changes reproject affected descendants and members.
- Admin mutations return exact indexing receipts. Do not replace receipt tracking with fake timers or optimistic “indexed” labels.

### Source ingestion

- Provider adapters emit provider-neutral batches through the shared ingestion contract.
- Source cursors advance only in the same transaction as canonical writes.
- Exact replays and version-only changes must not create false canonical revisions.
- Identity reservation is collision-safe and preserves provider identity through aliases/links.
- Locally dirty fields stay protected during inbound sync until provider acknowledgement.
- Source ownership, canonical ownership, and collection membership are separate concepts.

### Source writeback

- Local publication is the canonical commit; provider writes are asynchronous durable jobs.
- Job identity and retries are idempotent.
- Remote version conflicts require refetch/reconciliation, not blind overwrite.
- In-flight local edits must survive remote acknowledgement.
- Provider-owned memberships may write back; native collection memberships must not be misrepresented as provider-owned.
- Parent/child ordering, deletion, restoration, and file ownership must remain explicit.

### Runtime configuration

- One image serves multiple libraries through a validated server-side JSON manifest.
- Do not reintroduce tenant-specific build-time forks.
- Generated schema and catalog artifacts must stay synchronized with their typed source.
- Activation and rollback are versioned runtime operations.

## Source and documentation map

Read the smallest relevant set before changing code:

| Concern | Canonical starting points |
|---|---|
| Product/runtime overview | `README.md`, `docs/evidence-library-customization-map.md` |
| Runtime and operations | `docs/evidence-library-operations.md`, `config/library.example.json` |
| Deployed production snapshot | `docs/evidence-library-architecture.md` — reverify live facts before reuse |
| Canonical source model | `packages/evidence-library-core/src/schema.ts`, `docs/source-ingestion-contract.md` |
| Zotero adapter | `docs/zotero-source-adapter.md`, `src/lib/source-adapters/zotero/` |
| Sync orchestration | `docs/source-orchestration.md`, `src/lib/source-orchestration/` |
| Source writeback | `docs/source-writeback.md`, `src/lib/source-writeback/` |
| Search projection | `docs/search-indexing.md`, `src/lib/search-index/` |
| Admin item list | `docs/admin-item-list.md`, `src/components/admin/`, `src/lib/admin/` |
| Generated config schema | `public/library-config.schema.json`, `public/library-config.catalogs.json` |

Never assume the deployed production snapshot describes the `openscholar` branch, or vice versa.

## Planning doctrine

When work is large enough to justify a plan, create `plans/<kebab-case-topic>/` containing:

1. `00-README.md` with gap audit, locked decisions, inventory, dependencies, DRY donors, tests, migration stance, delegation policy, and grounding sources.
2. Numbered execution plans (`01-*.md`, `02-*.md`, …), each with goal, scope, design, TDD sequence, files touched, migration stance, exact test plan, deployability/runtime gate, acceptance criteria, and pitfalls.
3. `PROMPTS.md` with one self-contained copyable fenced prompt per numbered plan.

Ground every plan in current source, installed skills, and current primary documentation. Name exact donor modules. Plans must prescribe behavioral/ARIA/data-contract tests, not Tailwind or class-string assertions.

If implementation exposes a plan error, commit in-progress work, revise and commit the plan before continuing. If a required API truly does not exist or a pre-existing blocker prevents safe work, record a blocker document and stop instead of hiding it with a workaround.

## TDD and testing

Pure logic follows red → green → refactor. Write or update behavioral tests in the same slice as behavior changes. Prefer roles, accessible names, text, `aria-*`, `data-*`, database state, wire responses, and real worker state over implementation strings.

Forbidden tests include assertions on Tailwind utilities, CSS class strings, or inline styles. Layout and visual styling require Playwright/browser verification or screenshot comparison, not JSDOM class matching.

Core checks:

```sh
npm run lint
npx tsc --noEmit
npm run schema:check
npm run test:unit
npm run test:acceptance
```

Focused real-service commands:

```sh
npm run test:source-model
npm run test:source-writer
npm run test:zotero-source
npm run test:zotero-live
npm run test:zotero-writeback-live
npm run test:source-orchestrator
npm run test:source-writeback
npm run test:collection-writeback
npm run test:source-collections
npm run test:search-index
npm run test:search-worker
npm run test:native-lifecycle
npm run test:linked-item-lifecycle
```

Run the exact checks relevant to the changed slice, then broaden according to risk. Real-service verifiers require the environment documented beside their tools. A build or unit suite does not replace browser/runtime validation for user-facing or worker behavior.

For documentation-only changes, run `git diff --check` and verify every referenced command, branch, and Outline document ID.

## Development data and deployment boundaries

The `openscholar` development data is disposable. Prefer clean schema changes over compatibility shims or backfills. When a schema change invalidates dev rows, wipe and reseed the affected local/dev data unless the current task explicitly establishes production migration requirements.

The existing Evidence Library production fleet and its tenants are outside ordinary branch work. Do not mutate Coolify production, shared PostgreSQL, Meilisearch, Supabase, Zotero groups, domains, or existing tenant data unless the user explicitly authorizes that exact system and scope. Supported APIs plus readback are required for control-plane changes; do not write Coolify's internal SQL.

## Commit and push discipline

- Use conventional commit prefixes.
- Keep one concern per commit and commit each TDD green/logical unit.
- Never commit with tests red.
- Never use `--no-verify`, `--no-gpg-sign`, or hook-bypass flags.
- Stage explicit paths; never absorb unrelated dirty or untracked work.
- Do not push unless the user explicitly authorizes it.
- After pushing, read back the remote SHA and update Outline when durable shared truth changed.

## Completion standard

A task is complete only when:

1. the intended behavior is implemented without duplicate or legacy paths;
2. relevant tests pass;
3. schema/generated artifacts are synchronized when touched;
4. the real browser/worker/runtime path is verified in proportion to risk;
5. the diff contains only intended files;
6. commits are atomic and the authorized branch is pushed when requested; and
7. the canonical Outline page is updated and re-read when durable shared truth changed.
