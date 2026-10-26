# OpenScholar creates the search login (plan 07)

Issue: [openalex-count#963](https://github.com/OpenDevEd/openalex-count/issues/963) (openalex-count, branch `dev`).

## Goal

Library setup in OpenScholar asks the provisioner for the library's
Elasticsearch login instead of giving the library a private Meilisearch.

## Current code (openalex-count `dev`, 2026-10-25)

- `convex/evidenceLibraries/runtimeConfiguration.ts` hard-codes
  `EVIDENCE_LIBRARY_SEARCH_HOST = "http://meilisearch:7700"` and
  `EVIDENCE_LIBRARY_SEARCH_INDEX = "evidence_library"`.
- `convex/evidenceLibraries/applicationSetupActions.ts` generates the
  `elsearch_` key, stores it encrypted, and writes the two constants into
  `services.search`.
- `convex/evidenceLibraries/coolifyClient.ts` sets `MEILISEARCH_MASTER_KEY` on
  the Coolify application.
- `convex/evidenceLibraries/teardownActions.ts` already calls the database
  provisioner at `EL_DATABASE_PROVISIONER_URL`.
- `lib/evidence-libraries/configuration/ai.ts` describes the embedder block in
  Meilisearch terms.

## Scope

1. Setup calls `POST /v1/library-search/reconcile` on the provisioner with the
   library ID and the saved `elsearch_` key, and writes the returned `host` and
   `index` into `services.search`. Delete the two constants.
2. Stop setting `MEILISEARCH_MASTER_KEY`.
3. Teardown calls `POST /v1/library-search/remove`.
4. Reword the embedder comments in `ai.ts`. The block's shape doesn't change.

## Checks

- Setup, retry, and teardown tests with the provisioner fake.
- A development library created from OpenScholar indexes and searches, and
  teardown removes its login and indexes.

## Done when

New libraries get their search login from the provisioner, and no OpenScholar
code mentions Meilisearch.
