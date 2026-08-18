# Plan 01: Embedder settings in the library configuration

## Goal

The library configuration can describe a complete Meilisearch embedder, the public copy never shows the key, and Similar Resources cannot be turned on without one.

## Scope and design

1. In `src/config/library-config/schema.ts`, delete `search.embeddings` (line 664). Add `search.embedder`, a discriminated union on `source`, or `null`. Default `null`.
   - `openAi`: `{ source: "openAi", model: string (1-128), apiKey: secretSchema(1, 512), dimensions?: positive integer }`.
   - `rest`: `{ source: "rest", url: http(s) URL, apiKey?: secretSchema(1, 512), dimensions?: positive integer, request: object containing the string "{{text}}" somewhere, response: object containing the string "{{embedding}}" somewhere, headers?: record of string→string }`.
   - Use `.strict()` on each object. Reuse the existing URL primitive in `primitives.ts` if one exists; otherwise add one there.
2. Replace the check at `schema.ts:1580` with: `features.relatedResources` requires `search.embedder !== null`. Message: "Related resources require an embedder". Same rule for `features.aiSearch` ("AI search requires an embedder"), because chat rejects every global request without one.
3. Change `PLATFORM_SEARCH_EMBEDDER` in `catalogs.ts:207` to `"default"`.
4. In `src/config/library-config/public.ts:31`, stop passing `config.search` whole. Build the public `search` object with the existing fields plus `embeddings: config.search.embedder !== null`. Add `embeddings: z.boolean()` to the public search schema and remove `embedder` from it. The client keeps reading `search.embeddings` (`AiWrapper.tsx:238`); the server reads `search.embedder`.
5. Update every server reader of `config.search.embeddings` to `config.search.embedder !== null`: `src/lib/ai.ts:157`, `src/app/api/ai/chat/route.ts:44,49`, `src/app/api/ai/chat/quick.ts:131,204`, `src/app/api/ai/chat/search.ts:136`, `src/app/api/ai/embeddings/[key]/route.ts:14`.
6. Update the three hard-coded `embedder: "openai"` calls (`embeddings/[key]/route.ts:56`, `chat/quick.ts:212`, `chat/search.ts:297`) to `PLATFORM_SEARCH_EMBEDDER`. Do not change `semanticRatio` values.
7. Run `npm run schema:generate` so `public/library-config.schema.json` changes. Update `config/library.example.json` (`embeddings: true` → an `openAi` embedder example with a placeholder key) and `tests/acceptance/configs/*.json` (`embedder: null` unless a test needs it).
8. Update `docs/evidence-library-customization-visual.html:369,409` rows.

## Test-first steps

1. In `tests/unit/library-config-schema.test.ts`, replace the "related resources without embeddings" case (line 341) with "related resources without an embedder" (`config.search.embedder = null`).
2. Add failing cases: complete `openAi` accepted; `openAi` without `apiKey` rejected; `rest` without `url` rejected; `rest` whose `request` lacks `{{text}}` rejected; `rest` whose `response` lacks `{{embedding}}` rejected; unknown `source` rejected; `search.embeddings` key rejected (strict).
3. Add a failing public-projection test: `projectPublicLibraryConfig` output has `search.embeddings === true` and no `embedder` or `apiKey` anywhere in the JSON string.
4. Make them green, then run `npm run schema:check`.

## Files

- `src/config/library-config/schema.ts`, `catalogs.ts`, `public.ts`, `primitives.ts`
- `public/library-config.schema.json` (generated), `config/library.example.json`, `tests/acceptance/configs/*.json`
- `src/lib/ai.ts`, `src/app/api/ai/chat/route.ts`, `quick.ts`, `search.ts`, `src/app/api/ai/embeddings/[key]/route.ts`
- `tests/unit/library-config-schema.test.ts`, a public-projection unit test
- `docs/evidence-library-customization-visual.html`

## Data migration

None in PostgreSQL. Configuration files lose `search.embeddings` and gain `search.embedder`.

## Deployability gate

`npm run lint`, `npx tsc --noEmit`, `npm run schema:check`, and `npm run test:unit` pass. `npm run config:validate -- config/library.example.json` passes.

## Completion rules

- A configuration with `search.embeddings` is rejected.
- `relatedResources: true` with `embedder: null` is rejected with the message above.
- Complete `openAi` and `rest` embedders pass; each missing required field is rejected with a path.
- The public configuration JSON contains no `apiKey` and no `embedder`; it contains `search.embeddings` as a boolean.
- No file in `src/` contains the string `embedder: "openai"`.
- Generated schema artifacts match (`npm run schema:check`).

## Risks

- `AiWrapper.tsx` and other client code read the public `search` type. Keep the public field name `embeddings` so the client does not change.
- OpenScholar's config generator must add `search.embedder`. That is a follow-up on the OpenScholar side, not here.
