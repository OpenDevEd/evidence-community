# Plan 02: Create, update, and remove the index embedder

## Goal

The search worker writes the configured embedder to Meilisearch under the name `default`, waits for Meilisearch to finish, removes it when the configuration turns it off, and keeps running if the embedder step fails.

## Scope and design

1. Add `src/lib/search-index/embedder-settings.ts` with a pure function `buildEmbedderSettings(embedder: LibraryServerConfig["search"]["embedder"])` that returns the exact `embedders` object for `updateSettings`:
   - `null` → `{ default: null, openai: null }` (removes ours and the stale legacy name).
   - `openAi` → `{ default: { source: "openAi", model, apiKey, dimensions?, documentTemplate: PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE, documentTemplateMaxBytes: 8000 }, openai: null }`.
   - `rest` → `{ default: { source: "rest", url, apiKey?, dimensions?, headers?, request, response, documentTemplate, documentTemplateMaxBytes: 8000 }, openai: null }`.
   - Type the return with `Settings["embedders"]` from `meilisearch@0.60.0`.
2. Put `PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE` in the same file. It is a Liquid template over the projected document (`ItemSearchDocument` in `src/lib/search-index/projection.ts`): title, then abstract if present, then creators (`fullNames`), tags, and year. Check the exact field names in `ItemSearchDocument` before writing it. Keep it under 8000 bytes for any record.
3. In `src/lib/search-index/consumer.ts`:
   - Add `EMBEDDER_TASK_TIMEOUT_MS = 60 * 60 * 1_000`.
   - Add `applySearchIndexEmbedder(service, embedder, options)` that calls `service.index.updateSettings({ embedders: buildEmbedderSettings(embedder) })` and waits with `waitForSuccessfulTask(..., EMBEDDER_TASK_TIMEOUT_MS, { signal, taskClient: service.index.tasks, onProgress })`. Reuse the existing progress reporter so worker state shows `waiting`/`indexing` and the task uid.
   - Do not put the embedder into the existing `updateSettings` call in `ensureSearchIndex`; keep it a separate step so its failure can be caught on its own.
   - Confirm from Meilisearch (real test in Plan 03) that `{ openai: null }` is accepted when no `openai` embedder exists. If Meilisearch rejects it, read `getEmbedders()` first and only null names that exist. Record which one is true in this plan.
4. In `tools/runSearchIndexer.ts`, after `ensureSearchIndex` (line 131) call `applySearchIndexEmbedder` inside its own try/catch. On failure: `console.error`, `writeWorkerState({ lastError: "<name>: <message>", stage: "idle" ... })`, and continue into the outbox loop. Do not throw. The next worker start retries.
5. In `rebuildSearchIndex` (`consumer.ts:942`), apply the embedder the same way after `ensureSearchIndex`, so a rebuild also has embeddings.
6. In `src/app/api/ai/embeddings/[key]/route.ts`, catch a `MeilisearchApiError` whose `cause.code` is `invalid_search_embedder` and return `503` with `{ error: "Similar resources are not ready" }` and no public cache header. Leave other errors as they are.
7. Update `docs/search-indexing.md` with a short "Embedder" section: what the worker writes, the name `default`, the template, the 60-minute wait, and "restart the search worker after changing `search.embedder`".

## Test-first steps

1. `tests/unit/search-index-embedder-settings.test.ts`: failing tests for `buildEmbedderSettings` with `null`, `openAi`, and `rest`; assert exact objects, `documentTemplateMaxBytes === 8000`, and that the template mentions title and abstract fields.
2. `tests/unit/search-index-setup.test.ts`: extend the mocked client to record `updateSettings` calls; add failing tests that `applySearchIndexEmbedder` sends the embedders object, uses the 60-minute timeout, and throws `SearchIndexTaskError` when the mocked task fails.
3. A worker-startup test or script assertion that a failing embedder task leaves the worker running with `lastError` set (can be part of Plan 03's script if a unit test needs too much mocking; say which).
4. Make them green.

## Files

- `src/lib/search-index/embedder-settings.ts` (new)
- `src/lib/search-index/consumer.ts`
- `tools/runSearchIndexer.ts`
- `src/app/api/ai/embeddings/[key]/route.ts`
- `docs/search-indexing.md`
- `tests/unit/search-index-embedder-settings.test.ts` (new), `tests/unit/search-index-setup.test.ts`

## Data migration

None.

## Deployability gate

`npm run lint`, `npx tsc --noEmit`, `npm run test:unit` pass. Then Plan 03's `npm run test:search-embedder` passes against the fresh local Meilisearch.

## Completion rules

- With `embedder: null`, `updateSettings` receives `embedders: { default: null, openai: null }` (or the verified variant from step 3).
- With an `openAi` or `rest` embedder, `updateSettings` receives the full object with template and `documentTemplateMaxBytes: 8000` under the name `default`.
- The embedder task waits up to 60 minutes; ordinary tasks still use 5 minutes.
- A failed embedder task does not stop the worker; worker state shows `lastError`.
- The Similar Resources route answers 503 with a plain message when the embedder is missing.

## Risks

- Meilisearch may reject nulling a name that does not exist. Verify in Plan 03 before choosing.
- A large library re-embed can exceed 60 minutes on a slow provider. The worker then logs a timeout, keeps running, and retries on the next start while Meilisearch finishes the task in the background. Acceptable for now.
- Changing `apiKey` alone does not re-embed (Meilisearch documents this). Changing `model`, `url`, `request`, or the template does.
