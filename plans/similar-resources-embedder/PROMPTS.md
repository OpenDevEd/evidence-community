# Execution prompts

## Plan 01

```text
Read plans/similar-resources-embedder/01-embedder-config-schema.md and plans/similar-resources-embedder/00-README.md. Allow 2 to 3 hours. Keep working without asking questions already answered there.

STANDING RULES
1. Reuse searchSchema, aiProviderSchema, secretSchema, and the public projection. Do not invent a new secrets mechanism.
2. Delete search.embeddings. Do not add compatibility reads or defaults that keep it working.
3. Write failing schema and projection tests before changing the schema.
4. Regenerate artifacts with npm run schema:generate and keep npm run schema:check green.
5. Only openAi and rest sources. Embedder name is the constant PLATFORM_SEARCH_EMBEDDER = "default".
6. Use read-only agents for broad research; keep edits and commits in the main session.

EXECUTION RHYTHM
Red tests for the schema union and relatedResources rule, green, commit. Red test for the public projection, green, commit. Then update every reader of search.embeddings and every hard-coded "openai" embedder name, run lint/tsc/unit/schema:check, commit.

COMMIT DISCIPLINE
Conventional commits with [plan-01]. Stage named files only. Never commit with a relevant failing test or bypass hooks. Do not push.

WHEN TO STOP
Stop only when the completion rules pass or a real blocker file exists. Do not stop for a question answered in the plan.

DEVIATIONS
If the plan is wrong, commit safe work, update and commit the plan with docs: [plan-01] revise <section> — <reason>, then continue. Write 01-BLOCKER.md only for a missing required API.

START NOW
Read the plan and README, check git status on branch feat/similar-resources-embedder, open schema.ts around lines 657, 816, 1136, and 1580, and start the first red schema test.

Go.
```

## Plan 02

```text
Read plans/similar-resources-embedder/02-index-embedder-settings.md, plans/similar-resources-embedder/00-README.md, and completed Plan 01. Allow 3 to 4 hours. Keep working without asking questions already answered there.

STANDING RULES
1. Reuse waitForSuccessfulTask, ensureSearchIndex, the progress reporter, and writeWorkerState. Do not write a second task poller.
2. Embedder settings are a separate updateSettings call with a 60-minute cap. Ordinary tasks keep the 5-minute cap.
3. A failing embedder task must not stop the worker. Log, record lastError, continue.
4. The document template and documentTemplateMaxBytes: 8000 live in code and are always sent.
5. Read the meilisearch@0.60.0 types in node_modules for Settings.embedders before writing the builder.
6. Use read-only agents for broad research; keep edits and commits in the main session.

EXECUTION RHYTHM
Red tests for buildEmbedderSettings, green, commit. Red mocked tests for applySearchIndexEmbedder, green, commit. Wire the worker startup and rebuild, the 503 in the Similar Resources route, and the docs, run lint/tsc/unit, commit.

COMMIT DISCIPLINE
Conventional commits with [plan-02]. Stage named files only. Never commit with a relevant failing test or bypass hooks. Do not push.

WHEN TO STOP
Stop only when the completion rules pass or a real blocker file exists. Do not stop for a question answered in the plan.

DEVIATIONS
If the plan is wrong, commit safe work, update and commit the plan with docs: [plan-02] revise <section> — <reason>, then continue. Write 02-BLOCKER.md only for a missing required API.

START NOW
Read the plan and README, check git status, read consumer.ts lines 30-45, 428-514, and 838-960 and runSearchIndexer.ts lines 100-180, and start the first red builder test.

Go.
```

## Plan 03

```text
Read plans/similar-resources-embedder/03-local-embedder-verification.md, plans/similar-resources-embedder/00-README.md, and completed Plans 01 and 02. Allow 2 to 3 hours. Keep working without asking questions already answered there.

STANDING RULES
1. Fresh local Meilisearch only (tests/embedder/compose.yaml). Never point the script at a hosted library or the shared acceptance compose.
2. The REST stub runs in-process and returns fixed vectors. No OpenAI calls.
3. Copy the Meilisearch service shape from tests/acceptance/compose.yaml; add --experimental-allowed-ip-networks only there.
4. Assert real Meilisearch state: getEmbedders, index stats numberOfEmbeddedDocuments, and the invalid_search_embedder error code after disable.
5. Record in Plan 02 whether Meilisearch accepts { openai: null } for a missing embedder name, and fix buildEmbedderSettings if not.
6. Use read-only agents for broad research; keep edits and commits in the main session.

EXECUTION RHYTHM
Write the script assertions first and watch step 1 fail against the empty container. Then make each of the five steps pass, commit after the compose file and after the script is green. Run it twice.

COMMIT DISCIPLINE
Conventional commits with [plan-03]. Stage named files only. Never commit with a relevant failing test or bypass hooks. Do not push.

WHEN TO STOP
Stop only when npm run test:search-embedder passes twice, lint/tsc/unit pass, and docs are updated, or a real blocker file exists.

DEVIATIONS
If the plan is wrong, commit safe work, update and commit the plan with docs: [plan-03] revise <section> — <reason>, then continue. Write 03-BLOCKER.md only for a missing required API.

START NOW
Read the plan and README, check git status and docker, start the compose file, and write the failing script.

Go.
```
