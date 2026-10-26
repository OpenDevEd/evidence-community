import { MeilisearchApiError } from "meilisearch";

// Meilisearch reports a missing embedder with the first code and a failing
// embedding provider with the second. Both mean "not ready", not a bug.
const EMBEDDER_NOT_READY_CODES = new Set([
	"invalid_search_embedder",
	"vector_embedding_error",
]);

/** The search needed the embedder, which is missing or failing, as while the search worker still sets it up. */
export function isEmbedderUnavailable(error: unknown) {
	return (
		error instanceof MeilisearchApiError &&
		Boolean(
			error.cause?.code && EMBEDDER_NOT_READY_CODES.has(error.cause.code),
		)
	);
}
