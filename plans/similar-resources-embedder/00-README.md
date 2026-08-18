# Similar Resources embedder

Issue: [OpenDevEd/new-el#111](https://github.com/OpenDevEd/new-el/issues/111) (part of #94, EL-20).

## Problem

Similar Resources, AI search, and chat ask Meilisearch for hybrid search with `hybrid: { embedder: "openai" }`. Nothing in this repository ever creates that embedder on the index. `ensureSearchIndex` in `src/lib/search-index/consumer.ts:885-923` writes faceting, filterable, sortable, and searchable attributes only. Meilisearch therefore rejects every hybrid query with `invalid_search_embedder`, and Similar Resources never shows results.

The library settings cannot describe an embedder either. `search.embeddings` (`src/config/library-config/schema.ts:664`) is one on/off flag. There is no field for the source, model, key, URL, or dimensions.

## Fixed decisions

These were agreed with the owner on 2026-08-18. Do not reopen them.

1. Only issue #111. Do not touch #104 (blinking block) or #105 (shared AI service). Do not touch hosted libraries.
2. The embedder is fully configurable from the library configuration JSON. OpenScholar writes that JSON; this repository validates and applies it. No environment fallback.
3. Supported sources now: Meilisearch `openAi` and `rest`. `ollama` and `huggingFace` are additive later. `rest` already covers any HTTP embedding service.
4. The embedder has its own key field (`search.embedder.apiKey`). It does not reuse `ai.providers[].apiKey`. It uses `secretSchema` like every other secret and is stripped from the public projection.
5. Delete the `search.embeddings` boolean. Replace it with `search.embedder`, which is `null` (off) or a source object. Existing configuration files must be updated. No compatibility path.
6. `features.relatedResources: true` requires a complete `search.embedder`. This is checked at validation time only. No network check.
7. One fixed embedder name, `"default"`, exported as `PLATFORM_SEARCH_EMBEDDER` from `src/config/library-config/catalogs.ts`. Every hybrid caller uses it. Semantic ratios stay as they are.
8. The document template and `documentTemplateMaxBytes: 8000` are owned by this codebase, live in code, and are always sent. No template versioning.
9. When the settings change, Meilisearch re-embeds inside its own settings task. The worker waits for that task with the existing `waitForSuccessfulTask` helper and a 60-minute cap for the embedder task. Ordinary tasks keep the 5-minute cap.
10. Embedder settings are applied when the search worker starts, the same as every other index setting today. Changing them needs a search-worker restart. A config-watch loop is out of scope.
11. If the embedder task fails or times out, the worker logs it, records it in worker state, and keeps running without the embedder. It retries on the next start. No crash loop.
12. `search.embedder: null` removes the embedder from the index. Vectors are dropped.
13. Real tests use a fresh local Meilisearch (own compose file, own port, `--experimental-allowed-ip-networks`) and an in-process REST embedder stub that returns fixed vectors. Two indexes stand in for two libraries. No OpenAI calls in tests.
14. After the commits land, add one dated line to Outline "04 — Evidence Library Current State" and the provider decision to "06 — Current Decisions".

## Plan

1. [Embedder settings in the library configuration](01-embedder-config-schema.md)
2. [Create, update, and remove the index embedder](02-index-embedder-settings.md)
3. [Prove it against a real local Meilisearch](03-local-embedder-verification.md)

Plan 02 depends on Plan 01. Plan 03 depends on Plan 02.

## Existing code to reuse

- `src/config/library-config/schema.ts`: `searchSchema` (line 657), `aiProviderSchema` (line 1136) as the pattern for a secret-bearing object, the cross-field checks near line 1580.
- `src/config/library-config/primitives.ts:329`: `secretSchema`.
- `src/config/library-config/public.ts:13-58`: the public projection that must not leak the key.
- `src/config/library-config/catalogs.ts:207`: `PLATFORM_SEARCH_EMBEDDER`.
- `src/lib/search-index/consumer.ts`: `ensureSearchIndex` (line 838), `waitForSuccessfulTask` (line 428), `DEFAULT_TASK_TIMEOUT_MS` (line 39).
- `tools/runSearchIndexer.ts:131`: the only startup call to `ensureSearchIndex`; `writeWorkerState` for `lastError` and `stage`.
- `src/lib/meilisearch-factory.ts`: `MeilisearchService`.
- Hybrid callers: `src/lib/ai.ts:163`, `src/app/api/ai/embeddings/[key]/route.ts:56`, `src/app/api/ai/chat/quick.ts:212`, `src/app/api/ai/chat/search.ts:297`.
- Readers of the old flag: `src/app/api/ai/chat/route.ts:44,49`, `src/app/api/ai/chat/quick.ts:131,204`, `src/app/api/ai/chat/search.ts:136`, `src/lib/ai.ts:157`, `src/app/api/ai/embeddings/[key]/route.ts:14`, `src/components/features/newlib/AiWrapper.tsx:238`.
- Tests: `tests/unit/library-config-schema.test.ts:341` ("related resources without embeddings"), `tests/unit/search-index-setup.test.ts`.
- Real-service scripts to copy from: `tools/verifySearchOutbox.ts`, `tests/acceptance/compose.yaml` (`x-meilisearch-service`).
- Generated files: `public/library-config.schema.json`, `config/library.example.json`, `npm run schema:generate`.

## Tests

- Unit: schema accepts complete `openAi` and `rest` embedders, rejects incomplete ones, rejects `relatedResources` with `embedder: null`, public projection has no key.
- Unit: settings builder produces the exact `embedders` object for add, change, and remove, and includes the template and `documentTemplateMaxBytes: 8000`.
- Real Meilisearch (`npm run test:search-embedder`): enable, change, disable, rebuild, and hybrid search on two indexes with the REST stub; `numberOfEmbeddedDocuments` equals `numberOfDocuments`; a search with `hybrid.embedder = "default"` returns hits and no `invalid_search_embedder`.
- Main checks: `npm run lint`, `npx tsc --noEmit`, `npm run schema:check`, `npm run test:unit`.

## Data migration

None in PostgreSQL. Configuration files change: `search.embeddings` is removed and `search.embedder` is added. Update `config/library.example.json`, `tests/acceptance/configs/*.json`, and any local `config/library.local.json`.

## Agent use

Read-only agents mapped the code, Outline, and Meilisearch docs. The main session owns plan changes, test-first edits, commits, and live checks.

## Sources

- Meilisearch v1.37 docs: settings → embedders (which fields regenerate embeddings, `documentTemplateMaxBytes` default 400), tasks (no server-side timeout), index stats (`numberOfEmbeddedDocuments`), REST embedder (`url`, `request` with `{{text}}`, `response` with `{{embedding}}`, `dimensions` optional).
- `meilisearch@0.60.0` types: `Settings.embedders`, `Index.updateSettings`, `getEmbedders`, `resetEmbedders`.
- Legacy setup (Outline "Meilisearch VPS → Coolify migration"): OpenAI `text-embedding-3-small`, `documentTemplateMaxBytes: 8000`.
- `docs/search-indexing.md`, `docs/evidence-library-architecture.md:255-277`.
