# AI filter and search context research

Status: investigation and implementation recommendation, 2026-08-18. No product code was changed by this research.

## Direct conclusion

This does **not** need a separate browser-control agent or a large tool rewrite. The current page search and the AI `searchLibrary` tool should use one shared, typed search-state contract and one shared Meilisearch query compiler.

The AI should receive a validated snapshot of the current query and filters with each user message. That snapshot is application-owned context, not fields the model must reconstruct from a prompt. The model only needs two search choices:

1. search the library normally; or
2. search a bounded 200-publication window of the current multi-page result set, using the returned cursor to continue with the next window in a later message.

The existing two-tool contract remains sufficient. Only `searchLibrary` is extended; `readPublications` is unaffected.

## What the page currently controls

The canonical user-visible search state is already represented in URL query parameters:

| State | Search effect | AI tool today |
| --- | --- | --- |
| `search` | Free-text query | Not inherited; the model invents new `queries` |
| `scope` | Selects searchable fields, including title-only, author-only, metadata, PDF full text, or everywhere | Not supported; AI always uses index defaults |
| `sort` | Relevance, dates, author, or title ordering | Model may choose a sort, but the current value is not inherited |
| `range` | Publication date range | Not inherited; AI has a separate year/year-range shape |
| `institution` | Institution facets | Supported as model input, not inherited |
| `country` | Publication-country facets, including region expansion | Supported as model input, not inherited |
| `author_country` | Author-country facets, including region expansion | Missing from the AI tool |
| `author` | Exact author filter | Missing from the AI tool |
| `collections` | Collection ancestry filters | Supported as model input, not inherited |
| `page` | Selects the visible 20-result page | Presentation state; not part of the result-set identity |

`page`, `collectionId`, `referrer`, `error`, and `message` do not alter which publications belong to the complete result set and should not be sent as AI search context. The abstract display toggle and list/grid view are also presentation state.

The server also applies mandatory constraints that are not user controls: excluded item types, deleted items, blocked tags, and feature-flag-controlled searchable fields. These remain server-owned and must never become model inputs.

## Confirmed current defects

### 1. The chat request has no library state

The global library page opens `ChatModal` without passing the current `queryParams` or result page. `ChatModal` sends only the publication key, model, visitor ID, and chat mode. `chatRequestSchema` has no search-context field.

The model therefore cannot know which filters produced the page the user is looking at.

### 2. The UI and AI compile searches separately

`src/lib/search.ts` owns the public UI query compiler. `src/lib/ai/tools.ts` separately reconstructs only a subset of those filters. The two already differ:

- Public search respects `scope` through `attributesToSearchOn`; AI search does not.
- Public search supports author and author-country; AI search does not.
- Empty UI searches automatically use newest-first ordering; AI search does not reproduce that rule.
- UI full-text scope both restricts searchable attributes to PDF text and requires a full-text PDF. AI `fullTextOnly` only adds the existence filter.
- AI search always enables hybrid semantic search at `semanticRatio: 0.5`; the public result page currently does not. As a result, even matching text and filters would not reproduce the same ranking.
- Filter escaping and construction are duplicated.

This is the central DRY problem. Adding more parallel filter code would make the mismatch worse.

### 3. Current-result searching needs only one bounded operation

An existing free-text/semantic result set cannot be treated as an exact filter merely by concatenating another query: that changes matching and ranking.

For a current-result search, the server reruns the exact UI query and filters, collects the next deterministic window of at most 200 keys, and constrains the model's new parallel searches with `key IN [...]`. The tool returns a continuation cursor for the following 200. A normal library search continues to use the model's existing queries and optional filters.

The live development index was inspected read-only on 2026-08-18. `key` is filterable, and pagination is configured above normal result sizes, so bounded 200-key windows work without an index change. Do not materialize every key in a large result set in one request.

## Recommended shared contract

Create a client-safe schema for only the search-affecting state:

```ts
type LibrarySearchContext = {
  search: string;
  scope: ScopeKey;
  sort: SortKey;
  range: string;
  institution: string[];
  country: string[];
  authorCountry: string[];
  author: string;
  collections: string[];
};
```

Use closed enums derived from the existing `SCOPE_OPTIONS` and `SORT_OPTIONS`, bounded strings/arrays, and a validated date-range representation. Do not accept raw Meilisearch filter expressions from either the browser or the model.

Extract the existing logic in `resolveSearchRequest` into one server-side compiler that returns:

```ts
type CompiledLibrarySearch = {
  query: string;
  offset: number;
  limit: number;
  filters: string[];
  sort?: string[];
  attributesToSearchOn: string[];
};
```

Both `/api/items` and `searchLibrary` call this compiler. Agent search may opt into the existing hybrid configuration, but enumeration of the current result-set window must use the same search strategy as the public result page.

## Recommended `searchLibrary` extension

Keep one batched tool. Add only a current-results switch and continuation cursor:

```ts
{
  queries: string[];
  withinCurrentResults?: boolean;
  cursor?: string;
  filters?: {
    year?: number;
    yearRange?: [number, number];
    country?: string[];
    institution?: string[];
    collection?: string[];
    sort?: SortKey;
    fullTextOnly?: boolean;
  };
  limitPerQuery?: number;
}
```

When `withinCurrentResults` is false or omitted, preserve the existing tool behavior. When true, inspect at most 200 results from the app-owned current search. With no cursor, start at the beginning; with the prior result's cursor, continue with the next 200. Deep Research still defaults to full-text-only when searching the whole library.

Current-result searches return the inspected range, total count, `hasMore`, and a continuation cursor bound to a fingerprint of the normalized query, filters, scope, and sort. The cursor stays in local tool history, requires no server-side session, and is rejected against different search state.

## Passing the context through AI SDK 7

There are two consumers of the context: the model needs a short readable summary, while the tool executor needs the exact validated values. The current agent and tools are already constructed once per request, so AI SDK `toolsContext` would add an unnecessary second context interface here.

Pass the validated search context into `createResearchAgent`, include its concise summary in that request's instructions, and let `createResearchTools` close over the exact immutable values. This keeps application-owned state out of model-generated tool input without adding another seam. AI SDK's context facilities remain available if the tools are later reused independently, but they are not needed now. See [Runtime and Tool Context](https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context).

The browser should send the current context on every top-level user message, not only when the modal opens. AI SDK transports support dynamic request bodies and per-message request fields; see [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport). The route validates and freezes the snapshot before starting the agent so all tool steps in that response use the same state.

No page-filter mutation UI is required for the requested behavior. The agent interacts with the filters by receiving them as search context and using them to constrain `searchLibrary`. If automatic in-place UI mutation is requested later, it can be evaluated separately; AI SDK assigns browser-state mutations to client-side tools. See [Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage).

## Meilisearch fit

No Meilisearch migration or settings change is required.

Meilisearch's search API already accepts the complete combination needed here: query, offset/limit, attributes to retrieve, filter, sort, facets, `attributesToSearchOn`, and hybrid settings. Its response reports `estimatedTotalHits`, allowing tool activity to preserve result counts. See [Search with POST](https://www.meilisearch.com/docs/reference/api/search/search-with-post).

The existing batched parallel behavior may continue with application-side `Promise.all`, or later use Meilisearch multi-search. Multi-search gives every query its own filter, sort, limit, offset, and other parameters; it does not by itself solve textual result-set intersection. See [Search with different filters](https://www.meilisearch.com/docs/capabilities/multi_search/how_to/search_with_different_filters).

## File-level implementation path

1. Add a client-safe `LibrarySearchContext` schema/normalizer for only query, filters, scope, and sort.
2. Deepen the existing `src/lib/search.ts` module by exporting its normalized request compilation; do not add a parallel search service or adapter. Both public search and AI current-result windows use it.
3. Send the normalized context dynamically with every chat request and validate it in `chatRequestSchema`.
4. Pass the context into the per-request agent/tool factory and add its concise readable summary to the instructions.
5. Extend `searchLibrary` with `withinCurrentResults` and `cursor`. Internally fetch at most 200 current-result keys, run the existing parallel searches constrained to those keys, and return the inspected range plus next cursor.
6. Test public-search parity, bounded windows without overlap, stale-cursor rejection, mandatory constraints, and continuation through chat history.

## Explicit non-goals

- No new index or Meilisearch configuration.
- No client-provided raw filter syntax.
- No automatic PDF attachment from page state; `readPublications` keeps that responsibility.
- No new planner, orchestration service, or browser-control agent.
- No large list of result metadata added to every prompt.
- No page-filter mutation UI or third application tool.
