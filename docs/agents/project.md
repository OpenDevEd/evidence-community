# Evidence Library project guide

Read this after the shared `AGENTS.md`. This file owns Evidence
Library-specific facts, commands, and deployment boundaries.

## Product and repository boundary

- Repository: `Openscholar-ai/evidence-community` (formerly `OpenDevEd/new-el`).
- Active branch: `main`.
- This repository owns the public library, `/admin`, records, drafts,
  revisions, collections, files, runtime configuration, search indexing,
  source imports, Zotero sync and writeback, and runtime workers.
- `Openscholar-ai/openscholar` on `dev` owns Openscholar research features,
  accounts, billing, and Evidence Library setup and management.
- Cross-repository calls use an authenticated, versioned, retry-safe API. Do
  not rebuild Openscholar research tools here.
- There is no production for this product yet. This work prepares for a future
  production release through Openscholar `main`.

## Off limits: the `coolify` branch and its tenants

- 17 live tenants used by real organisations run the old Evidence Library from
  the `coolify` branch, held together by manual setup. This product will
  eventually replace them, but until then they are off limits. Never touch,
  delete, or clean up them or anything they use: their Coolify applications,
  databases, Meilisearch indexes, Supabase bucket, domains, and shared Zotero
  groups.
- The `coolify` branch is off limits. Never read it, compare against it, or
  describe it as production, unless the user asks to pull something specific
  from it. Never push to, delete, or rewrite it: any push redeploys every one
  of those tenants.
- `docs/evidence-library-architecture.md` documents only those off-limits
  tenants. Read it only when the user asks for work on them.

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

Read `docs/evidence-library-operations.md` before deployment work.

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
- Application state uses route handlers and SWR where already established,
  alongside the shared React rules in `AGENTS.md`.

## Local checks and CI

The command list in `package.json` is authoritative.

- Run the smallest relevant unit test while coding:
  `npm test -- <test-file>`.
- Before every push, run `npm run quality:fallow -- --base origin/main` and fix
  what it reports. It takes about a second, and CI blocks on the same check.
- Run the matching type, lint, schema, browser, or real-service check only when
  its boundary changed.
- `npm run check:ui-rules` runs in CI and enforces the UI rules agents kept
  breaking: no animation that also transitions opacity or transform, no
  uppercase labels, no native `title` tooltips, no dot separators (code and
  `src/messages`), no "Loading" text, and no icon or picture centred beside a
  title with a line under it (`icon-top`). Each error names the fix. A line that
  needs an exception says why on the line before it:
  `// ui-rules-allow: <rule> -- <reason>`. The rules live in `tools/uiRules.ts`.
- A PR creation or update uses those targeted checks, not a full local
  `npm run check:changed` run.
- When a change touches a loading state, a dialog, popover or menu, or motion,
  check it with `npm run verify` (the `verify` skill): `up`, `shift <route>`
  with a `--do` step for each changed interaction, look at the screenshots,
  then `down`. It compares with the main commit the branch starts from, on the
  same seeded data.
- Verify changed runtime behavior with the focused browser or service check.
  The full `npm run test:acceptance` suite belongs to CI, or an explicitly
  requested full-suite diagnosis. Clean up disposable acceptance environments
  with `npm run test:acceptance:cleanup`.
- Real database, Meilisearch, storage, source, Zotero, and publication commands
  are integration checks. Run only the command that owns the changed contract.

GitHub CI runs on the isolated self-hosted runners documented in
`docs/self-hosted-ci.md`. It owns the full static checks and the aggregate `CI`
result on the exact PR head. A pull request runs the acceptance smoke scope (Amber
and the browser tests tagged `@smoke`); `main` and the nightly run run the full
suite on both libraries. A merge is done only when that full run on `main` passes:
fix or revert a failure there before other work. The runtime job uses four
Playwright workers.

GitHub can't enforce the aggregate `CI` check on this private repository
without GitHub Pro, so read it on the exact head yourself before merging.

## Deployment and data safety

- `docs/evidence-library-operations.md` is the deployment runbook.
- Do not use the user's `new-el-optimize` checkout.
- Before any Coolify branch change, read every target application's current
  `git_branch`.
- Use the supported Coolify API and read changed values back. Never edit
  Coolify's internal database.
- Keep development acceptance runtimes uniquely named and delete only what the
  current task created.
- Library data (records, revisions, and configuration) must never be lost.
  Development libraries are used for MVPs and showcases, and future libraries
  will rely on updates keeping their data. Every schema or stored-data change
  ships an explicit migration and rollback choice. Never widen a validator
  merely to keep obsolete rows.
- Runtime configuration revisions are immutable records. Replace a revision by
  activating a new valid revision, not by editing history.

## References

- Off-limits `coolify` tenants: `docs/evidence-library-architecture.md`.
- Operations: `docs/evidence-library-operations.md`.
- Test rules: `docs/test-quality.md`.
- Runtime customization history:
  `docs/evidence-library-runtime-customization-plan.md`.
