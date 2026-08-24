## Rule zero: write for normal people

This is the most important rule in this file. Use plain, everyday language in every reply, plan, pull request, issue, document, commit message, code comment, error message, and piece of interface text. Write so that someone without a technical background can understand it on the first read.

1. Start with the answer or the next action. Do not start with a preamble.
2. Use short sentences and common words. If a technical term is necessary, explain it in plain language.
3. If there is more than one step, use a numbered list with no more than five items. Keep each step to one clear action.
4. Say what is done, what is happening now, and the one next action. Use concrete time estimates when time matters.
5. Remove tangents, repeated summaries, vague wording, corporate language, academic language, metaphors, and unnecessary detail. For errors, say what failed, why it failed, and how to fix it.

### Examples

| Bad | Good |
|---|---|
| “The provider-neutral transactional ingestion foundation has been implemented.” | “The library can now import records from different sources without creating duplicates.” |
| “The operation failed because of an upstream provider conflict.” | “Zotero changed after we loaded the record. Reload it, compare the changes, and try again.” |
| “This milestone is materially complete based on the implementation evidence.” | “This milestone is done. All three issues are closed and tested.” |
| “We should operationalize the remaining deployment concerns.” | “Next: test creating a new library on the development server.” |
| “The system persists canonical state while asynchronously projecting derived search documents.” | “PostgreSQL stores the real record. Meilisearch receives a searchable copy in the background.” |

Before sending or publishing anything, reread it once and simplify it. These rules are always active, even when the `i-have-adhd` skill was not explicitly requested.

## Four rules that always apply

1. **Reuse before building.** Search the repository first. Extend an existing component, service, schema type, adapter, worker, fixture, test tool, or document when it already solves part of the problem.
2. **Check facts instead of guessing.** Words such as “likely,” “possible,” “probably,” and “I think” mean you need to stop and check. Use `find-skills`, the right installed skill, current official docs, library source, and web research.
3. **Do not keep old behavior.** This branch is still in testing. Make clean breaking changes, delete replaced code, and do not add compatibility layers or fallback paths unless the user asks for them.
4. **Do not interrupt work over secrets.** The user accepts environment values appearing in terminal output and agent history. Do not rotate keys, lecture about exposure, or add redaction work unless asked.

## What this repository owns

This repository is the **Evidence Library runtime**. It owns the public library website and the `/admin` record editor. It also owns records, drafts, revisions, deleted-record markers, collections, files, runtime configuration, search indexing, source imports, Zotero sync, Zotero writeback, and the workers that run these jobs.

OpenScholar lives in `OpenDevEd/openalex-count` on branch `dev`. It owns research discovery, literature reviews, screening, extraction, synthesis, research organization, billing, and the future setup and publishing flow for Evidence Libraries.

Do not rebuild OpenScholar’s research tools here. The two repositories must talk through a clear API that is authenticated, versioned, and safe to retry.

The active branch in this repository is `main`.

## Read Outline before product or roadmap work

The shared knowledge base is the **OpenScholar** collection in Outline.

### Main pages

- Collection: `16480726-288c-42f7-9912-5047444585c9`
- Start here: `cc243a51-87ec-4137-869e-0e791f6161f4`
- Evidence Library current state: `57d9f73d-4fce-430d-b0ad-da11903141b6`
- Product boundaries: `ff5168e3-7289-42b2-a3e4-a07401fcfce1`
- Integration contract: `ff15f65c-bf85-48b3-baf5-e849f85cde41`

### More pages

- Architecture and data ownership: `c5a528cb-ae33-4282-96d6-a3fa28036709`
- Current decisions: `636ce019-6fe6-4a4e-918b-95e0912cc92d`
- Development runbooks: `30b7169b-1530-424a-a374-80478d1bee56`
- Knowledge-base rules: `81d7111b-d75c-46d2-9229-e1eb44934195`

For product, architecture, roadmap, or cross-repository work:

1. Check that the Outline MCP server works.
2. Read the Start page.
3. Read the Evidence Library current-state page.
4. Read only the other pages needed for the task.
5. Check any claim about current behavior against this branch, its tests, the real service tools, and the running app.

If Outline is down, continue only when the repository gives you enough information. Say clearly that Outline could not be read. Never claim an Outline update worked until you read the page again.

## Keep Outline accurate

Outline stores shared facts, not a copy of every commit. After a verified change is pushed, update the smallest existing Outline page when the change affects:

- a product or architecture decision;
- which repository owns something;
- what is actually built;
- a supported development or support process; or
- deployment setup or roadmap meaning.

Search before creating a page. Update the existing main page instead of making a duplicate. Include the date, repository, branch, commit, and proof. Keep old decisions and explain why they changed. Do not document work that is still uncommitted.

## Which source wins

When two sources disagree, use this order:

1. The user’s latest instruction.
2. Current branch code, tests, commit history, and verified runtime behavior.
3. Current Outline decisions.
4. The relevant product roadmap.
5. Old plans, prototypes, transcripts, and audits.

The `main` branch is the source of truth for current progress.

Zotero sync and writeback already work here. This includes source collection management, collection membership writeback, and drag and bulk collection actions. Read the code before planning. Never list Zotero writeback as untouched future work.

The BeeWriter `roadmap.qmd` is still the main Evidence Library and self-service roadmap. Ignore its obsolete warning. In that roadmap, the “subscription website” means OpenScholar. `roadmap-v2.qmd` is a smaller Discover-to-Publish pilot, not a replacement for the full roadmap.

## Next.js and React

This repository uses Next.js 16 and React 19. Before changing a Next.js API, route, cache rule, request rule, or file layout, read the matching guide under `node_modules/next/dist/docs/`.

Do not use `useEffect`, `useLayoutEffect`, or `useInsertionEffect` to copy state, mirror props, derive values, manage URL state, fetch data, trigger mutations, or control filters, tabs, pages, or forms.

Use Server Components, route handlers, SWR where the project already uses it, `nuqs`, values calculated during render, lifted state, context, and event handlers.

An effect is allowed only when a real browser or outside system needs setup and cleanup. Examples are event listeners, observers, timers, and third-party widgets. Put it in the smallest component or hook. Include full cleanup and complete dependencies.

## Data rules that must stay true

### Records and files

- PostgreSQL stores the real data. Meilisearch only stores a searchable copy.
- Public records change only through publish, unpublish, and restore actions.
- Drafts stay private. They are not public records.
- Deleted record keys stay reserved and are never silently reused.
- File drafts and published files are separate states.

Record revisions, relationships, search events, and required writeback jobs must save in the same database transaction.

### Search

- The search worker reads the latest PostgreSQL state. It does not rebuild old payloads from events.
- A Meilisearch request is complete only after Meilisearch reports that its task succeeded.
- Leases and one-at-a-time processing must stop an older record version from replacing a newer one.
- Attachment changes must reindex their parent. Collection changes must reindex affected children and members.
- Admin changes must return real indexing receipts. Never fake an “indexed” state with a timer or hopeful label.

### Source imports

- Every source adapter sends the same provider-independent batch format.
- A source cursor moves forward in the same transaction as the imported record changes.
- Replaying the same data, or receiving only a source version change, must not create fake record revisions.
- Key reservation must handle collisions and keep the source identity through links and aliases.
- Local edits stay protected during imports until the source confirms them.

Source ownership, record ownership, and collection membership are different things. Do not mix them.

### Source writeback

- Publishing locally is the real commit. Updates to Zotero or another source happen later through saved worker jobs.
- Retrying a job must not create duplicate remote work.
- When the source changed remotely, reload and reconcile it. Never overwrite it blindly.
- A newer local edit must survive confirmation of an older writeback request.
- Only source-owned collection memberships may be written back as source memberships.

Keep parent and child order, deletion, restoration, and file ownership clear at every step.

### Runtime configuration

- One container image serves different libraries from a validated server-side JSON file.
- Never bring back customer-specific builds.
- Keep generated schemas and option catalogs in sync with their TypeScript source.
- Activation and rollback always use named versions.

## Where to start reading

Read only what the task needs.

| Work | Start here |
|---|---|
| Product and runtime | `README.md` and `docs/evidence-library-customization-map.md` |
| Runtime operations | `docs/evidence-library-operations.md` and `config/library.example.json` |
| Current production setup | `docs/evidence-library-architecture.md`, then check the live system |
| Source data model | `packages/evidence-library-core/src/schema.ts` and `docs/source-ingestion-contract.md` |
| Zotero imports | `docs/zotero-source-adapter.md` and `src/lib/source-ingestion/zotero/` |
| Source scheduling | `docs/source-orchestration.md` and `src/lib/source-ingestion/orchestrator.ts` |
| Source writeback | `docs/source-writeback.md` and `src/lib/source-writeback/` |
| Search indexing | `docs/search-indexing.md` and `src/lib/search-index/` |
| Admin record table | `docs/admin-item-list.md`, `src/components/admin/`, and `src/lib/admin/` |
| Generated config files | `public/library-config.schema.json` and `public/library-config.catalogs.json` |

Never treat the production snapshot as proof of what this branch does. Never treat this branch as proof of what production is running.

## How to write a large plan

Put a large plan in `plans/<kebab-case-topic>/`.

It needs three things:

1. `00-README.md`: the gap, fixed decisions, plan list, dependencies, existing code to reuse, tests, data migration choice, agent use, and sources.
2. Numbered files such as `01-topic.md`: goal, scope, design, test-first steps, files, data migration choice, exact tests, runtime check, completion rules, and risks.
3. `PROMPTS.md`: one complete copyable prompt for every numbered plan.

Use the real code, installed skills, and current official docs. Name the exact code that should be reused. Tests in plans must check behavior, accessibility, or data. Do not tell an agent to test Tailwind class names.

If coding shows that the plan is wrong, commit safe work first. Update and commit the plan before continuing. If a needed API does not exist, or an existing bug makes the work unsafe, write a blocker file and stop. Do not hide the problem with a workaround.

## Tests

Before creating, changing, deleting, or reviewing any test or assertion, use
the `test-decision` skill and read
[`docs/test-quality.md`](docs/test-quality.md).

Do not add or change tests for copy-only, style-only, comment-only,
documentation-only, or behavior-preserving refactor changes. Run the existing
checks and inspect the real result instead. Exact wording needs a test only when
the wording is itself a lasting legal, security, accessibility, or protocol
contract.

When behavior, data, authentication, an API, accessibility, or plain logic
changes, add or update the smallest honest behavior test in the same change.
Use red → green → clean up for new plain logic. Prefer roles, labels, visible
text, `aria-*`, `data-*`, database rows, API responses, and real worker state.

Do not test Tailwind classes, CSS class strings, or inline styles. Use Playwright or screenshots for layout and visual styling.

### Main checks

During implementation, run the smallest relevant test on the local machine:

```sh
npm test -- tests/unit/library-config-source.test.ts
```

Before pushing code, run the fast branch checks locally:

```sh
npm run check:changed
```

This runs lint, TypeScript, generated-schema checks, all unit tests, and Fallow.
Fallow checks only code changed from `origin/main`. It blocks new dead code,
complexity, duplication, and styling problems without treating the existing
codebase as clean.

Run the full acceptance suite once before pushing when a change affects the
browser, runtime configuration, database, workers, search, files, or provider
flows:

```sh
npm run test:acceptance
```

The normal local command keeps the large admin browser suite at one worker for
stability. GitHub sets four workers on its Blacksmith runner. Do not export
`CI=true` or `PLAYWRIGHT_WORKERS=4` locally unless you are deliberately stress
testing the machine.

Every local acceptance run must leave Docker clean. The normal command removes
its environment automatically. Use `--keep` only while you are actively
inspecting that environment. Before ending the task, run:

```sh
npm run test:acceptance:cleanup
```

This removes acceptance environments whose test process has ended, including
ones started with `--keep`. A testing task is not done until this command reports
that no abandoned acceptance projects remain. Do not stop unrelated development
containers.

Do not run the full acceptance suite after every edit or commit. GitHub keeps
the complete acceptance suite as a required merge check. Use Blacksmith Testbox
only to reproduce a failure that needs a clean Linux machine or differs from
GitHub. Warm one Testbox, reuse it for the investigation, and stop it afterward.

### Real-service checks

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

Run the checks that match the change, then run wider checks when the risk is higher. Real-service tests need the environment described beside their tools. A build or unit test does not replace checking the real browser, worker, or service.

For documentation-only work, run `git diff --check`. Also check every command, branch name, and Outline page ID mentioned in the document.

## Development data and live systems

Development data on `main` is disposable. Prefer a clean schema change over compatibility code or a backfill. If a schema change breaks development rows, wipe and reseed the affected local or development data unless the task specifically needs a production migration.

Existing Evidence Library production tenants are off limits unless the user names the exact system and gives permission. Do not change shared Coolify, PostgreSQL, Meilisearch, Supabase, Zotero groups, domains, or tenant data on your own.

For control-plane changes, use the supported API and read the value back. Never edit Coolify’s internal database directly.

## Git rules

- Use conventional commit prefixes.
- Keep one concern in each commit. Commit each working test-first step or clear unit of work.
- Never commit while relevant tests are failing.
- Never use `--no-verify`, `--no-gpg-sign`, or another hook bypass.
- Stage named files. Do not include unrelated local work.

Do not push unless the user clearly asks. After a push, read back the remote commit. Update Outline only when the pushed change alters shared facts.

## When the task is done

The code is done when:

1. The requested behavior works without duplicate or old paths.
2. The right tests pass.
3. Generated schemas and catalogs match their source when they changed.
4. The real browser, worker, or service was checked when the change affects it.

The delivery is done when:

1. The diff contains only the intended files.
2. Commits are small and clear, and the branch is pushed only when requested.
3. Outline is updated and read back when the pushed work changes shared facts.
