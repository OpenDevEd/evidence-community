# Database-driven search indexing

PostgreSQL is canonical. A library searches the engine its configuration
chooses (`services.search.engine`): its own index on the host's shared
Elasticsearch, written through the library's alias and signed in as its own
login (see "Run the shared Elasticsearch" in
`docs/evidence-library-operations.md`), or its private Meilisearch. Either index
is a derived, disposable item projection maintained from the transactional
`outbox`.

## Projection

Every top-level search document contains:

- canonical and provider identity, including source connection and scope;
- all canonical Zotero-style metadata;
- normalized tags and direct collection keys;
- current collection ancestry;
- derived author names, institutions, countries, year, and sortable date;
- open access: an editor's choice in `/admin` (`item.openAccess`), else the
  `is_oa` of the newest OpenAlex version among the copies of the record's work
  that the library's current searches still find, else what OpenAlex said
  about the DOI the record shows (`itemOpenAccessLookup`), else null. Taking a
  search out of the library, or putting it back, searches its records again.
  The source worker looks at records from other sources, unless an editor
  chose, when they change or the library mints them a DOI, asks OpenAlex about
  a new DOI, 100 DOIs a request, and asks about every DOI again after 30 days;
- child attachment metadata; and
- active attachment full text split into page records. The page text is
  indexed only when the library has full-text search on; otherwise only the
  page numbers are kept, which still mark records that have a PDF. Switching
  full-text search rebuilds the index.

Child items are embedded in their parent document and never become standalone
search results. A child event reprojects its parent. A tombstoned or missing
top-level item removes the search document.

Collection rows remain in PostgreSQL. A collection event expands its current
descendants and reprojects their member items, so a move, rename, restore, or
deletion cannot leave stale collection facets.

## Telling search engines

A community with `generation.indexNow` on tells IndexNow (Bing and the search engines that share it) which records'
pages each claim changed, as soon as the claim is acknowledged: the ones written and the ones removed. A record that
has just been hidden is among them, as its page is gone. Openscholar turns it on for live
communities only. The indexer never waits for it: one request is out at a time, at most 10,000 addresses, with five
seconds between requests, and a list that fails is logged and dropped, because the sitemap still names every record. A
whole-index rebuild sends nothing. The key is served at `/indexnow-key.txt` and is made from the community's own secret
(`src/lib/indexnow.ts`).

## Delivery guarantees

Each event has a claim owner and expiry. The consumer maintains a heartbeat
while it builds the projection and writes it. Claims in one library
take a single transaction-scoped advisory lock, so they run one at a time; each
claim then uses `FOR UPDATE SKIP LOCKED` and skips entities already covered by
an active lease. This keeps two workers from applying different revisions of
the same entity out of order, with one lock per claim rather than one per
event: PostgreSQL's lock table is shared by every library database on the
server. An expired claim is recoverable.

The worker writes each claim with Elasticsearch's bulk API, and its last
request waits until the change is searchable (`refresh: wait_for`), so
`processedAt` means readers can find it. Elasticsearch answers for each record:
a record it refuses for its content (a mapping or parsing error) fails the
claim with `SearchIndexDocumentError`, and the claim is halved until the event
behind that record is found, so only that event retries. An overload (429),
a server error, or a failed request keeps the whole claim for retry. Failures
increment `attempts`, clear the lease, and set an exponential `nextAttemptAt`. Each event in a failed batch is marked on
its own, so a lease lost on one event does not leave its batch siblings leased
until the lease expires; the error the worker logs names the failure that
caused it. The default 15-attempt schedule starts at
five seconds, caps each delay at one hour, and spans several hours before an
event is dead-lettered. Operators can reset all dead letters through the
explicit requeue command.

Processing is idempotent. A crash after a successful write but before the
PostgreSQL acknowledgment causes the same current document to be written
again. Stale events cannot overwrite a newer canonical revision because every
attempt reads current PostgreSQL state rather than reconstructing historical
event payloads.

The drain claims up to 5,000 events and coalesces duplicate parent/child work.
It works on three claims at once, so one claim is projected while another is
written.

A very large backlog is faster to index as a rebuild. When at least 50,000
events wait and they cover at least a quarter of the records, the worker saves
the list of waiting events, rebuilds the index, and then acknowledges exactly
those events: the rebuild read every record after they were committed. Events
written during the rebuild stay queued and are drained afterwards.

A rebuild fills a new index, `<alias>_<timestamp>`, with refresh off, one write
in flight while the next records are projected, and then moves the library's
alias to it in one step. Readers search the old index until then. The old index,
and any a stopped rebuild left behind, are deleted. Elasticsearch then merges
the new index into one segment in the background: on AIED that halves search
time (about 55 to 26 ms at the 95th percentile), and the rebuild does not wait
for it. A worker may write a change
to the old index, and acknowledge its event, after the rebuild read that record;
every event acknowledged after the rebuild started is therefore put back once
the alias moves, and the drain writes it again. On AIED (282,948 records) a
rebuild takes about 5 to 8 minutes; reading the records from PostgreSQL is the
slower half. Measured before records had vectors: a rebuild now also reads each
record's stored vector to reuse it, and calls no embedder (see Embedder).

Projection reads remain bounded to at most 500 item keys, while outgoing bulk
requests are split by serialized size and stay below a 20 MiB default budget. A
single larger document is sent alone.

The index is created by the worker from `src/lib/search-index/elasticsearch-index.ts`.
Its version is part of the projection signature, so a changed definition marks
a rebuild as pending and the worker rebuilds into a new index at its next start.

## Result window

A library on Meilisearch numbers every result of a search, up to the 10 million
its worker sets as `maxTotalHits`. A library on Elasticsearch numbers the first
10,000 (page 500 at 20 a page), its `index.max_result_window`: past that the
results page moves only by next and previous, and the AI's reading of a reader's
current results stops there. A library with connections to both engines, as during
a switch, keeps to Elasticsearch's limit, since its readers can be on either.

## Switching engines

Only the chosen engine's index is kept current. `status.searchEngine` names the
engine whose index holds every record, and readers search it; each web process
reads it at most every 5 seconds, and searches the configured engine while it
is empty. When the worker starts with another engine configured, it builds that
engine's index while readers stay on the old one, then sets
`status.searchEngine`, puts back the events acknowledged meanwhile, and deletes
the old index 10 seconds later, once no reader still searches it. A library
upgraded from before engines were recorded keeps its index and records its
engine without a rebuild; if its configuration already names the other engine,
readers stay on the engine that holds its records until the new index is built.
If Meilisearch's embedder fails while its index already holds records, the
switch waits, and readers and the worker's writes stay on the old engine. So
they do when the configured engine can't be set up or built, such as an
Elasticsearch login not made yet. In both cases the worker keeps the old engine
current, reports the failure as its last error, and starts over every 30
minutes to try the switch again.

A record the engine refuses, such as a value its mapping can't hold, fails the
whole rebuild, and the worker's last error names the record and the reason. A
switch then waits as above. A rebuild of the engine readers already search
fails at each start, and readers keep the index as it was until the record is
fixed.

The worker drains no changes while it rebuilds, so readers see changes made
during a switch only once it completes: minutes, or longer for a switch to
Meilisearch with an embedder, since Meilisearch embeds every record as it
indexes it. A switch to Elasticsearch writes the records without vectors and
moves readers once every record is there; the backfill embeds them afterwards,
and until it finishes Similar Resources answers 503 and AI search ranks by
words alone (about 17 minutes for AIED on OpenRouter, 28 hours on a 16-core CPU
model).

To switch, publish a configuration revision that changes only
`services.search.engine` and keeps the old engine's connection. Remove the old
connection only once the worker has logged `"oldIndexRemoved":true`: before the
switch completes, readers would search the new index while it is still being
built, and once the connection is gone, nothing deletes the old index. An old
index a stopped switch left behind is deleted at the worker's next start while
the old connection is still there.

Prove a switch on a real library with both engines' connections (it switches to
the other engine and back, and fails if a reader's public result count ever
drops below PostgreSQL's):

```sh
LIBRARY_CONFIG_PATH=<library with both connections> npm run test:search-switch
```

Check the outbox worker on either engine:

```sh
SEARCH_ENGINE=meilisearch MEILISEARCH_URL=http://127.0.0.1:7700 \
  DATABASE_URL_POST=postgresql://... npm run test:search-index
```

## Reading Openscholar's search engine

An OpenAlex source can read Openscholar's own search engine instead of OpenAlex. Its API key chooses that, written
`openscholar-search:<key>:<Access client id>:<Access client secret>`. The source's query is the engine's OQL. The
engine holds no update dates or year counts to read by, so the source reads every work on each run, as one stream. A
record keeps OpenAlex's id; a work without one is left out, as is a second work under the same id. Records have no
references, because the engine names them by its own ids.

## Index-only libraries

A read-only library that holds millions of records can skip the database: `services.search.indexOnly` is `true`, the
engine is Elasticsearch, and records live only in the index. PostgreSQL holds no records, and readers read records, the
record count and the engine from Elasticsearch. Its one filled table is `institutionCountry`, a small list of where each
institution is, which the map's institutions and the flags beside affiliations read. A load doesn't fill it. Such a library has no admin, drafts, collections or statistics, and no sources.
Its configuration must leave off everything that finds records in the database: reader accounts, collections, downloads,
the Atom feed, the home page, AI search, deep research, related resources, notifications and the sitemap. Ask AI stays
available, because it reads records from the index. OpenScholar's reads of the community come up
empty too, because they go through its database.

The search worker leaves the index alone, because a rebuild reads the database and would empty it. Two things hold that
in place: activating a configuration that turns `indexOnly` off is refused, and the index itself says it holds the only
copy of the records, so a worker that lost the setting still stops. Change a record by loading it again, not through
the worker.

`npm run search:load-index-only` builds the index from gzipped JSON lines of OpenAlex works, without the API or the
database. Run it in the library's network, in four steps, all but the first with `--files <folder> --state <folder>`:
`--prepare`, then `--links`, then one `--part <i>/<n>` per process, then `--finish`. `--links` reads every file once to
find which works cite each other, because a part sees only its own files; this is what fills a record's References and
Citations lists. Run it again when the files change. A part remembers each finished
file under `--state`, per index, so a stopped load carries on. It stops when Elasticsearch fails or is too busy, goes on
past a damaged file, and exits non-zero whenever a file or record didn't load, naming the first of each kind. Run it
again to try the unfinished files; a record refused in a finished file stays out. Keys come from OpenAlex's ids, so
loading a work again replaces it.

`--finish` refuses until every file has finished loading into the new index, and until `--accept-refused` accepts any
records that didn't load. It then moves readers to it and merges its segments. The index readers left stays, and `--finish` prints its name, so a person can check the new one and delete it.

## Embedder

Similar Resources, AI search, and chat rank by meaning as well as words when the
library has an embedder. The library configuration describes it in
`search.embedder`, the same way for both engines:

- `null` turns embeddings off. Related resources cannot be enabled.
- `{ "source": "openAi", "model": "text-embedding-3-small", "apiKey": "…" }`
  uses OpenAI.
- `{ "source": "rest", "url": "…", "request": { … "{{text}}" … }, "response": { … "{{embedding}}" … } }`
  uses any HTTP embedding service. `["{{text}}", "{{..}}"]` in the request
  sends several texts at once, and `[{ … "{{embedding}}" … }, "{{..}}"]` in the
  response reads one vector for each.

Each record's embedded text is the platform document template
(`src/lib/search-index/embedder-settings.ts`): its title, abstract, authors,
keywords, and year, cut to 8,000 bytes. Libraries cannot change it.

### Meilisearch

The worker writes the embedder under the fixed name `default`
(`PLATFORM_SEARCH_EMBEDDER`) when it starts, together with the document
template and `documentTemplateMaxBytes: 8000`, and Meilisearch calls the
embedder itself. Meilisearch embeds every record inside that one settings task,
so the worker waits up to 60 minutes for it. If the task fails, the worker logs
the error, records it as `lastError`, and keeps indexing records without
embeddings. Setting `search.embedder` to `null` removes the embedder and its
vectors.

Changing `search.embedder` needs a search-worker restart. Check
`GET /indexes/<index>/stats`: `numberOfEmbeddedDocuments` must equal
`numberOfDocuments`.

### Elasticsearch

Elasticsearch's free licence stores and searches vectors but can't call an
embedding service, and its own result fusion needs a paid licence
(OpenDevEd/new-el#720). So the worker calls the embedder and the application
mixes the results.

Writing records:

- Each record is written with its vector in `embedding`, a 32-bit float
  `dense_vector` compared by cosine and not quantised. The first vector sets the
  number of dimensions. `embeddingHash` records the embedder and the text the
  vector came from, and `embeddingModel` the embedder alone.
- A record written again with the same text keeps its vector. A rebuild only
  copies the vectors of the index readers search and calls no embedder: it takes
  minutes, and a stopped rebuild loses no embedding work.
- After each outbox pass, the worker embeds records that have no vector,
  starting no new page after 30 s, then drains the outbox again. What it embedded stays when it stops.
  This fills a library after a rebuild that changed records' text, after an
  embedder change, after a switch from Meilisearch, and on its first build. A
  model served from 16 CPU cores embedded 2.8 AIED records a second, about a day
  for all of AIED; OpenRouter embedded up to 3,005 a second (below). On 29
  October 2026 the backfill gave all 282,948 AIED records a vector in 16
  minutes 47 seconds, 281 a second, at 128 requests of 50 texts: Elasticsearch
  wrote one bulk request at a time into the index's one shard and used about
  one core, so writing, not the embedder, set the speed.
- Changing `search.embedder` rebuilds the index, so no vector of the old
  embedder stays; the worker then embeds every record with the new one. With
  `null`, records are written without a vector. Header values don't count, as
  they can hold a key, so choose the model in the request template: a change
  to a header's value keeps the old vectors.
- When the embedder fails, records are written without a vector, so word search
  stays current, and the worker records the error as `lastError`. It leaves the
  embedder alone for a minute, doubling up to 30 minutes, and the backfill
  embeds those records once it answers. OpenRouter's 402, for an account out of
  credit or over its budget for requests in flight, is such a failure.
- A text the embedder refuses, as one too long for it, gets its hash and
  `embeddingModel` without a vector, and isn't sent again until its text or the
  embedder changes. A refused batch is split to find the texts it refuses.
- The worker sends a REST embedder 128 requests at once of 50 texts each, and
  OpenAI 128 of 64, shared by everything it embeds. Set
  `SEARCH_EMBEDDER_PARALLEL_REQUESTS` (1 to 512) and
  `SEARCH_EMBEDDER_BATCH_TEXTS` (1 to 512) on the search worker to change them.
  The library's Compose file doesn't pass them: Coolify saves an unset
  `${NAME:-}` as null, OpenScholar then refuses all of the application's
  variables, and it removes any variable it doesn't manage.
  The defaults suit the platform's OpenRouter embedder. A model on a few CPU
  cores needs about 8 requests of 10 texts, and OpenAI's lower tiers fewer
  requests than 128: at the defaults their requests run out of time or are
  refused as busy, and the backfill doesn't finish. The backfill reads twice as many records as the
  requests in flight hold, up to 10,000, and writes their vectors 500 records a
  request. To choose, time the embedder on the library's own records; it writes
  nothing, but a paid embedder charges for what it embeds:

  ```sh
  LIBRARY_CONFIG_PATH=… npm run search:embedder-speed -- --records 10000 --parallel 128 --batch 50
  ```

  With several `--parallel` numbers it shares the records out among them. It
  also reports the answers by status, the most requests in flight at once,
  seconds a request, how busy the worker's JavaScript thread was, and the
  worker's CPU and bytes received for every 1,000 records.

  On 29 October 2026, OpenRouter's `perplexity/pplx-embed-v1-0.6b` embedded
  10,000 of AIED's records at these settings, with every answer a 200 and none
  refused. Where a 10,000-record page holds fewer requests than allowed, all
  were sent at once and the run took as long as the slowest; the second column
  shows the requests that were in flight at once:

  | Texts a request | Requests at once | Records a second | Seconds a request |
  | --- | --- | --- | --- |
  | 10 | 8 | 155 | 0.52 |
  | 10 | 128 | 1,744 | 0.53 |
  | 10 | 256 | 2,374 | 0.75 |
  | 10 | 512 | 2,083 | 1.55 |
  | 50 | 64 | 2,420 | 0.81 |
  | 50 | 128 | 3,005 | 1.41 |
  | 50 | 200 of 256 | 2,885 | 1.93 |
  | 100 | 32 | 1,840 | 1.07 |
  | 100 | 64 | 2,773 | 1.47 |
  | 100 | 100 of 128 | 2,621 | 2.08 |
  | 189 | 16 | 1,210 | 1.47 |
  | 189 | 32 | 2,302 | 1.63 |
  | 189 | 53 of 64 | 2,391 | 2.33 |

  Above about 2,500 texts in flight each request took longer, so no setting
  passed about 3,000 records a second. Settings that used less of the worker's
  CPU, with more texts a request, were no faster, which points to OpenRouter
  rather than the worker; the event-loop figure the tool now reports can
  confirm it.
  At 3,005 a second, embedding AIED's 282,948 records takes about 1.6 minutes,
  at about $0.001 for every 1,000. The worker used about 0.35 CPU seconds for
  every 1,000 records with 50 or more texts a request (0.5 with 10), and
  received about 1.4 KB for each; serialising a record's vector for
  Elasticsearch took 0.12 CPU seconds for every 1,000 and 9.4 KB. A backfill takes longer
  than embedding alone: it writes each page's vectors to Elasticsearch before
  it embeds the next page. Requests of 200 texts held about 189 within 256 KB.
  The same model on 16 CPU cores embedded 2.8 records a second.

Searching:

- Similar Resources mixes the 50 records nearest the record's stored vector
  (weight 0.7) with the 50 best word matches for its description (0.3), and
  shows the first six. It calls no embedder, and answers 503 until the record
  has a vector.
- AI search and chat embed the question and mix the nearest records with the
  word results, 0.5 each. They wait 3 s for the embedder; then words alone rank
  the search, and the next 30 s of searches skip the embedder. A search the
  reader asked to sort still mixes them, as Meilisearch's hybrid search does:
  the words order ranks by relevance first and the sort breaks its ties.
- On a library that searches with Elasticsearch, Similar Resources, AI search,
  deep research and the chat about a record all search Elasticsearch alone; a
  library still on Meilisearch keeps Meilisearch's own hybrid search.
- Both compare only vectors the same embedder made (`embeddingModel`), so while
  a library rebuilds after changing its embedder, questions embedded by the new
  one find no old vectors and rank by words.
- Both mix the two orders by reciprocal rank fusion, Elastic's formula:
  `weight / (60 + rank)`, summed for each record. Meilisearch instead merges
  the two lists by weighted score and keeps each record once at its better one,
  so a record found both ways ranks higher here than on Meilisearch. Facet
  counts come from the word results.

Vectors need memory beside the heap, for each library on the host
([Elasticsearch: approximate kNN memory](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/approximate-knn-search)).
For AIED, 282,948 records at 1,024 dimensions:

| Index option | Memory beside the heap |
|---|---|
| `hnsw`, 32-bit floats (chosen, 2026-10-27) | 1.16 GB, plus 18 MB for the graph |
| `int8_hnsw` | 0.29 GB, plus the graph |
| `bbq_hnsw`, Elasticsearch's default from 9.1 | about 40 MB, plus the graph |

Hassan chose unquantised floats. Perplexity's `pplx-embed-v1` models output int8
values, so `int8_hnsw` would lose almost nothing and need a quarter of the
memory; changing `index_options` changes the index version and rebuilds.

To see how many records lack a vector, count them on the library's alias (they
include records whose text the embedder refused):

```http
GET <alias>/_count
{"query": {"bool": {"must_not": [{"exists": {"field": "embedding"}}]}}}
```

Elasticsearch leaves vectors out of the records it sends back unless a search
asks for them with `"_source": {"exclude_vectors": false}`.

Going back to code from before this change rebuilds each Elasticsearch library
without vectors, and coming forward again embeds every record again.

To check the Elasticsearch flow without any paid provider, run the script
against a local Elasticsearch. It starts a stand-in embedder, then checks
turning the embedder on, searching by meaning and from a record, changing a
record, a rebuild that reuses vectors, a failing embedder, changing the
embedder, and turning it off:

```sh
ELASTICSEARCH_URL=http://127.0.0.1:59200 ELASTICSEARCH_PASSWORD=local-search-password npm run test:search-embedder
```

To check the Meilisearch flow, start the dedicated test container and run the
script with `SEARCH_ENGINE=meilisearch`. It checks enable, search, change,
disable, and rebuild on two indexes:

```sh
docker compose -f tests/embedder/compose.yaml up -d --wait
SEARCH_ENGINE=meilisearch npm run test:search-embedder
docker compose -f tests/embedder/compose.yaml down
```

If port 57710 is taken, pick another one for both steps:

```sh
EMBEDDER_TEST_MEILI_PORT=57730 docker compose -f tests/embedder/compose.yaml up -d --wait
SEARCH_ENGINE=meilisearch MEILISEARCH_HOST=http://127.0.0.1:57730 npm run test:search-embedder
```

### Comparing the engines

`npm run search:compare` loads one library's records into Elasticsearch and runs
the 50 reader searches in `tools/search-comparison/aied-queries.json` on an
engine. `aied-meilisearch-baseline.json` holds what Meilisearch answered for
them on AIED before EL-32, the reference for Elasticsearch's ranking
(OpenDevEd/new-el#717). `tools/compareSearchEngines.ts` lists the commands.

## Local operation

Start a local Elasticsearch with the ICU plugin, and give the local library a
login named after its `services.search.elasticsearch.index`, with its
`services.search.elasticsearch.key` as the password (the database provisioner
does this on a host):

```sh
docker build -f docker/elasticsearch.Dockerfile -t evidence-library-elasticsearch:9.5.5 .
docker run -d --name evidence-library-local-elasticsearch \
  -p 127.0.0.1:59200:9200 \
  -e discovery.type=single-node \
  -e ELASTIC_PASSWORD=local-search-password \
  -e xpack.security.http.ssl.enabled=false \
  -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
  evidence-library-elasticsearch:9.5.5
```

Set `services.search.engine` to `elasticsearch` and
`services.search.elasticsearch.host` in the local library configuration to
`http://127.0.0.1:59200`, then run:

```sh
npm run search:index
npm run search:index -- --watch
npm run search:index -- --rebuild
npm run search:index -- --requeue-dead-letters
```

Run one worker per library at a time: against a deployed library, stop its
`search-indexer` container first. Two workers rebuilding at once delete each
other's new index.

`--watch` polls continuously and stops cleanly on `SIGINT` or `SIGTERM`.
`--rebuild` streams current top-level items into a new index, moves the alias to
it, then drains the outbox. Search keeps answering from the old index until the
alias moves.
`--requeue-dead-letters` resets terminal events to immediately retryable state
and can be combined with either one-shot or watch mode.

## Production worker

Deploy a library with `docker/compose.library.yaml`. It runs the web app and all
four workers from the same immutable image, starts private persistent
Meilisearch and private ephemeral Redis, mounts the same writable runtime
configuration volume into the application containers, and makes the search
worker apply database migrations before it starts. The web app waits until the
required workers and Redis are healthy.

Set `LIBRARY_CONFIG_JSON` to the complete validated seed document, then use the
repository Compose file as the deployment source of truth. Ordinary
configuration publishes replace the active file in the shared volume through
the authenticated runtime API; they do not redeploy the stack. Do not deploy
the web target by itself and do not configure index settings with a separate
Meilisearch command. The worker creates and updates those settings at startup.

`docker/compose.library.yaml` is the only application deployment. It runs the
web app, search worker, source-sync worker, source-writeback worker,
publication worker, private Meilisearch, and private Redis. The source workers
remain idle when no source is configured.

On Meilisearch, use `http://meilisearch:7700` as the runtime search host and
set the runtime search key and `MEILISEARCH_MASTER_KEY` to the same private
value. Meilisearch has no public port and joins only the private application
network. On Elasticsearch, use the host, index and login from the library's
search receipt (`http://evidence-library-elasticsearch:9200`). The five
runtime containers also join the external deployment network to reach shared
PostgreSQL, and `web` and `search-indexer` join `library-search`, the shared
Elasticsearch's network, which must exist on the host
(`docs/evidence-library-operations.md`, "Run the shared Elasticsearch"). Automatic destination-network attachment must stay off.
Meilisearch runs with `MEILI_UPGRADE_DB`, so a newer pinned image migrates the
existing search data in place when it starts. It also runs with
`MEILI_EXPERIMENTAL_LEGACY_SEARCH`: Meilisearch's newer search path
builds every result before the requested page, which made the deepest page of
a 1M-record library take 18 s; the legacy path returns the same totals, facets
and hits (apart from the order of exactly tied scores) in under 0.2 s. Check
this again before each Meilisearch upgrade. Removing the variable does not
always switch the legacy path off: any `PATCH /experimental-features` sent while
it is on stores `legacySearch: true`, so read `GET /experimental-features`.
If the named search volume is new, the worker records a pending rebuild in
PostgreSQL before creating the index. It clears that marker only after the full
rebuild succeeds. An interrupted rebuild resumes before health becomes ready.

Build the dedicated worker target from the same revision as the web image:

```sh
docker build --target search-indexer -t evidence-library-search-indexer .
```

Run one worker service per library. Mount the same runtime configuration used
by the web service and give the service a stable logical worker identity:

```sh
docker run -d \
  --name evidence-library-search-indexer \
  --restart unless-stopped \
  -e LIBRARY_CONFIG_PATH=/runtime/library.json \
  -e SEARCH_INDEX_WORKER_ID=search-indexer-1 \
  -v /srv/evidence-library/runtime:/runtime:ro \
  evidence-library-search-indexer
```

The worker stores its stage, heartbeat, the number of events it is indexing,
last completion, and last error in
PostgreSQL. The container health check fails while startup is still preparing
the index, when its durable heartbeat is more than twenty seconds old, or when
that heartbeat belongs to a replacement container generation.
Delivery errors remain visible across restarts and clear only after a later
event succeeds. Database migrations must be applied before a new worker
revision starts.

## Admin observability

Published admin mutations return an `indexingReceipts[]` set with one receipt
for every outbox row committed by their transaction. Each receipt contains an
entity type, canonical key, and revision.
Returning the complete set matters when an attachment is moved between parents:
the update is finished only after the attachment, previous parent, and new
parent receipts are indexed. Draft and upload-staging changes do not return
receipts because they do not affect the public search projection.

The admin application uses three private, non-cacheable endpoints:

- `GET /api/admin/search-index` returns the current worker stage, plus
  lightweight pending/failed queue signals;
- `POST /api/admin/search-index/receipts` resolves up to 100 exact receipts as
  queued, processing, retrying, indexed, failed, or unknown. Before it returns
  an indexed receipt, it immediately expires the affected Next.js item,
  citation, metadata, or collection cache tags; and
- `POST /api/admin/search-index/retry` explicitly requeues selected failed
  receipts or all failed receipts. It never resets active, queued, or already
  indexed work.

Overview polling intentionally does not calculate queue counts. This keeps the
hot status request bounded as a library's outbox history grows. Exact progress
belongs to the mutation's receipt set, and callers wait until every receipt in
that set reaches `indexed`. The admin shows final publish, restore, unpublish,
file, collection, and bulk success only after that wait finishes. Public API
and proxy cache headers are a separate policy and are not changed by this flow.

The real-service verifier creates isolated indexes and proves document shape,
collection reprojection, re-parent cleanup, tombstone deletion, restoration,
byte-aware requests, a refused record, retry, dead-letter requeue, entity lease
serialization, expired-lease recovery, a full rebuild, and a change written to
the old index while a rebuild runs:

```sh
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
ELASTICSEARCH_URL=http://127.0.0.1:59200 \
ELASTICSEARCH_PASSWORD=local-search-password \
npm run test:search-index
```

The worker lifecycle verifier additionally starts an isolated production Next
server and database, then exercises process health, rolling replacement
fencing, historical errors, active PostgreSQL cancellation, durable task
progress, receipt states, targeted and global retry, startup failures, graceful
shutdown, and a real publish-edit-unpublish lifecycle through HTTP and
Elasticsearch. It creates its test libraries' logins as the administrator:

```sh
LIBRARY_CONFIG_PATH=config/library.local.json \
DATABASE_URL_POST=postgresql://library:library@127.0.0.1:55435/library \
ELASTICSEARCH_ADMIN_URL=http://elastic:local-search-password@127.0.0.1:59200 \
EVIDENCE_LIBRARY_ADMIN_SESSION_COOKIE='<cookies from a signed-in browser>' \
npm run test:search-worker
```

The cookies must come from the library in `LIBRARY_CONFIG_PATH`; see "Real-service
admin sign-in" in the operations guide for signing in with a Clerk test user
instead.
