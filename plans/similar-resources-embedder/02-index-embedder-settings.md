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
   - Confirmed in Plan 03 against Meilisearch v1.37: `{ openai: null }` is accepted when no `openai` embedder exists. No `getEmbedders()` read is needed.
4. In `tools/runSearchIndexer.ts`, after `ensureSearchIndex` (line 131) call `applySearchIndexEmbedder` inside its own try/catch. On failure: `console.error`, `writeWorkerState({ lastError: "<name>: <message>", stage: "idle" ... })`, and continue into the outbox loop. Do not throw. The next worker start retries.
5. `rebuildSearchIndex` does not apply the embedder itself. The worker is its only production caller and applies the embedder right before it, so a rebuild adds documents to an index that already has the embedder. (Revised during work: `rebuildSearchIndex` has no access to the library configuration, and adding it would change three verify tools for no gain.)
6. In `src/app/api/ai/embeddings/[key]/route.ts`, catch a `MeilisearchApiError` whose `cause.code` is `invalid_search_embedder` and return `503` with `{ error: "Similar resources are not ready" }` and no public cache header. Leave other errors as they are.
7. Update `docs/search-indexing.md` with a short "Embedder" section: what the worker writes, the name `default`, the template, the 60-minute wait, and "restart the search worker after changing `search.embedder`".

## Test-first steps

1. `tests/unit/search-index-embedder-settings.test.ts`: failing tests for `buildEmbedderSettings` with `null`, `openAi`, and `rest`; assert exact objects, `documentTemplateMaxBytes === 8000`, and that the template mentions title and abstract fields.
2. `tests/unit/search-index-setup.test.ts`: extend the mocked client to record `updateSettings` calls; add failing tests that `applySearchIndexEmbedder` sends the embedders object, uses the 60-minute timeout, and throws `SearchIndexTaskError` when the mocked task fails.
3. The worker's two decisions live in pure helpers in `bootstrap-state.ts` and are unit-tested in `tests/unit/search-index-bootstrap.test.ts`: `resolveIdleLastError` (a failed embedder stays in `lastError` after later batches succeed) and `resolveRebuildTaskTimeoutMs` (rebuild document tasks get the embedding wait only when the embedder is active).
4. `tests/unit/similar-resources-route.test.ts` covers the Similar Resources route: shared embedder name in the search call, 503 for `invalid_search_embedder` and `vector_embedding_error`, other Meilisearch errors rethrown, empty result without a search when the embedder or the feature is off, 404 for an unknown record.
5. Make them green.

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
- The Similar Resources route answers 503 with a plain message when the embedder is missing (`invalid_search_embedder`) or its provider fails on the query (`vector_embedding_error`).
- A failed embedder stays in worker `lastError` after later record batches succeed; only the next worker start clears it.
- With an embedder set, the startup rebuild's document tasks use the 60-minute wait, because they embed too.

## Risks

- Declined review idea: removing a failed embedder before draining the outbox. That drops every vector and forces a paid re-embed on any provider blip. Outbox retries with backoff cover an outage instead.
- Known, out of scope (#107): `src/app/api/ai/chat/search.ts` swallows per-query search errors and answers "No relevant items". That is how the missing embedder stayed hidden. Chat should surface search failures as unavailable.

- Meilisearch may reject nulling a name that does not exist. Verify in Plan 03 before choosing.
- A large library re-embed can exceed 60 minutes on a slow provider. The worker then logs a timeout, keeps running, and retries on the next start while Meilisearch finishes the task in the background. Acceptable for now.
- Changing `apiKey` alone does not re-embed (Meilisearch documents this). Changing `model`, `url`, `request`, or the template does.
