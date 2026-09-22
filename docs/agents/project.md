# Evidence Library project guide

Read this after the shared `AGENTS.md`. This file owns Evidence
Library-specific facts, commands, and deployment boundaries.

## Product and repository boundary

- Repository: `OpenDevEd/new-el`.
- Active branch: `main`.
- This repository owns the public library, `/admin`, records, drafts,
  revisions, collections, files, runtime configuration, search indexing,
  source imports, Zotero sync and writeback, and runtime workers.
- `OpenDevEd/openalex-count` on `dev` owns OpenScholar research features,
  accounts, billing, and Evidence Library setup and management.
- Cross-repository calls use an authenticated, versioned, retry-safe API. Do
  not rebuild OpenScholar research tools here.

## Shared product facts

For product, architecture, roadmap, or cross-repository work, check Outline in
this order:

1. Start: `cc243a51-87ec-4137-869e-0e791f6161f4`.
2. Evidence Library current state: `57d9f73d-4fce-430d-b0ad-da11903141b6`.
3. Integration contract when both repositories are involved:
   `ff15f65c-bf85-48b3-baf5-e849f85cde41`.
4. Current decisions: `636ce019-6fe6-4a4e-918b-95e0912cc92d`.
5. Only the other page needed for the task.

The collection is `16480726-288c-42f7-9912-5047444585c9`. Check changing
claims against `main`, tests, real-service tools, and the running app. If
Outline is unavailable, say so and use the repository only when it contains
enough evidence.

After a verified pushed change, update the smallest existing Outline page only
when product ownership, a decision, built behavior, deployment setup, or a
supported process changed. Read the page back before claiming success.

## Runtime invariants

Read `docs/evidence-library-architecture.md` for the full design and
`docs/evidence-library-operations.md` before deployment work.

- PostgreSQL stores the real record and job data. Meilisearch is a rebuildable
  search copy.
- Public records change through publish, unpublish, and restore. Drafts stay
  private and deleted keys stay reserved.
- Record changes, search work, and required writeback work save in the same
  database transaction.
- Workers read the latest PostgreSQL state. Older jobs must never overwrite a
  newer revision.
- A Meilisearch request is complete only after its task succeeds.
- Source adapters use the shared provider-independent batch contract.
- Source cursors advance in the same transaction as imported data.
- Imported snapshots are provider-owned. Editors apply `itemDraft` field
  patches; do not copy provider fields into a second record model.
- Writeback is transactional, retry-safe, and visible through saved jobs.
- One built Next.js image serves many libraries. Each library loads one
  server-side JSON configuration at runtime. Do not put library configuration
  in `NEXT_PUBLIC_*` values or bake it into the image.
- Configuration activation is atomic. Invalid revisions never partly apply,
  and the last valid revision remains usable.

Use `docs/evidence-library-customization-map.md` for field ownership and
`docs/evidence-library-operations.md` for health, rollback, and release
steps.

## Next.js and React

- This repository uses Next.js 16 and React 19.
- Before changing a Next.js API, route, cache rule, request rule, or file
  layout, read the matching installed guide under
  `node_modules/next/dist/docs/`.
- Do not use React effects for copied state, URL state, derived values, data
  loading, navigation, mutations, filters, tabs, pages, or forms.
- Effects are only for a real outside browser system. Keep them small and
  include full cleanup and dependencies.
- Reuse server components, route handlers, SWR where already established,
  `nuqs`, render-time calculations, lifted state, context, and event handlers.

## Local checks and CI

Read `docs/test-quality.md` and use `test-decision` before touching tests.
The command list in `package.json` is authoritative.

- Run the smallest relevant unit test while coding:
  `npm test -- <test-file>`.
- Run the matching type, lint, schema, browser, or real-service check only when
  its boundary changed.
- A PR creation or update uses those targeted checks, not a full local
  `npm run check:changed` run.
- Verify changed runtime behavior with the focused browser or service check.
  The full `npm run test:acceptance` suite belongs to the pre-merge CI gate, or
  an explicitly requested full-suite diagnosis. Clean up disposable acceptance
  environments with `npm run test:acceptance:cleanup`.
- Real database, Meilisearch, storage, source, Zotero, and publication commands
  are integration checks. Run only the command that owns the changed contract.
- Documentation-only work needs link checks and `git diff --check`, not the
  application suite.

GitHub CI runs on the isolated self-hosted runners documented in
`docs/self-hosted-ci.md`. It owns the full final static lanes, runtime
acceptance, and aggregate merge gate on the exact PR head. Follow the CI
section in `AGENTS.md`: ordinary edits finish after targeted verification;
automatic CI runs in the background. Local lanes do not repeat the full suite.

The runtime job uses four Playwright workers. Read the aggregate `CI` result
for the exact head before merging. The current GitHub plan cannot enforce that
check for this private repository, so the integration owner must enforce it.

## Deployment and data safety

- `docs/evidence-library-operations.md` is the deployment runbook.
- Production tenants, branches, databases, buckets, indexes, domains, and
  shared Zotero groups are off limits unless the user names the exact
  production action.
- Never push `coolify` or `openscholar`; a push can redeploy production
  tenants.
- Do not use the user's `new-el-optimize` checkout.
- Before any Coolify branch change, read every target application's current
  `git_branch`.
- Use the supported Coolify API and read changed values back. Never edit
  Coolify's internal database.
- Keep development acceptance runtimes uniquely named and delete only what the
  current task created.
- Schema and stored-data changes need an explicit migration and rollback
  choice. Never widen a validator merely to keep obsolete rows.
- Runtime configuration revisions are immutable records. Replace a revision by
  activating a new valid revision, not by editing history.

Only the integration owner changes shared or production services. An
implementation lane owns only its isolated worktree and explicitly assigned
development resources.

## Plans and current references

Use a committed plan only for the cases named in `AGENTS.md`. Keep task
contracts in the plan and link to shared rules instead of copying agent
prompts.

- Architecture: `docs/evidence-library-architecture.md`.
- Operations: `docs/evidence-library-operations.md`.
- Test rules: `docs/test-quality.md`.
- Runtime customization history:
  `docs/evidence-library-runtime-customization-plan.md`.
