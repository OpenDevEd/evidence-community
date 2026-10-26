import { errors as ElasticsearchErrors } from "@elastic/elasticsearch";
import { MeilisearchApiError } from "meilisearch";

import type { LibraryServerConfig, SearchEngineName } from "@/config/library-config/schema";
import { RevisionAwareSearchFactory } from "@/lib/elasticsearch-factory";
import { RevisionAwareMeilisearchFactory, type MeilisearchService } from "@/lib/meilisearch-factory";

import { elasticsearchWriter } from "./elasticsearch-writer";
import { EMBEDDER_TASK_TIMEOUT_MS } from "./embedder-settings";
import { applySearchIndexEmbedder, meilisearchWriter } from "./meilisearch-writer";
import { SearchOutboxAbortError, type SearchIndexWriter } from "./writer";

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1_000;

/** What the search worker sets up in one engine for a library (OpenDevEd/new-el#722). */
type SearchWriterSetup = {
	writer: SearchIndexWriter;
	/**
	 * Sets up what this engine needs after its index exists and before records are written: Meilisearch's embedder.
	 * A failed embedder doesn't stop record indexing; it comes back as `embedderError`, with whether the index already
	 * holds records that a rebuild through the broken embedder would lose.
	 */
	prepare(signal: AbortSignal): Promise<{ embedderError: string | null; indexHasRecords: boolean }>;
	/** How long a rebuild task may wait: every record task also embeds while an embedder is set. */
	rebuildTaskTimeoutMs: number;
	/** Whether this engine holds an index of the library with records in it. */
	hasRecords(): Promise<boolean>;
};

type Config = Pick<LibraryServerConfig, "revision" | "services" | "updatedAt" | "search">;

function connection(config: Config, engine: SearchEngineName) {
	const configured = config.services.search[engine];
	if (!configured) throw new Error(`This library has no ${engine} connection.`);
	return { configuration: configured, revision: config.revision, updatedAt: config.updatedAt };
}

/** Deep result pages are fast only on Meilisearch's legacy search path, which a stored flag can override. */
async function warnWithoutLegacySearch(service: MeilisearchService) {
	const features = await service.client.getExperimentalFeatures();
	if ((features as { legacySearch?: boolean | null }).legacySearch !== true) {
		console.warn(
			"Search index: Meilisearch's legacy search path is off, so deep result pages will be slow. Set MEILI_EXPERIMENTAL_LEGACY_SEARCH=true and check GET /experimental-features.",
		);
	}
}

/** Applies the library's embedder, logging its progress; the worker reads as idle meanwhile. */
async function applyEmbedder(service: MeilisearchService, config: Config, signal: AbortSignal) {
	let lastLine = "";
	await applySearchIndexEmbedder(service, config.search.embedder, {
		onProgress: async (progress) => {
			const line = `${progress.stage} task ${progress.taskUid ?? "?"}${progress.batchProgress === null ? "" : ` ${progress.batchProgress}%`}`;
			if (line === lastLine) return;
			lastLine = line;
			console.log(`Search index embedder: ${line}`);
		},
		signal,
	});
	console.log(config.search.embedder ? "Search index embedder: ready" : "Search index embedder: removed");
}

/**
 * A failed embedder doesn't stop record indexing: the next worker start retries it, and Similar Resources stays
 * unavailable until then. A stop of the worker still stops it.
 */
async function embedderFailure(service: MeilisearchService, error: unknown, signal: AbortSignal) {
	if (error instanceof SearchOutboxAbortError && signal.aborted) throw error;
	const embedderError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	console.error(`Search index embedder failed: ${embedderError}`);
	return { embedderError, indexHasRecords: (await service.index.getStats()).numberOfDocuments > 0 };
}

async function meilisearchSetup(config: Config): Promise<SearchWriterSetup> {
	const service = await new RevisionAwareMeilisearchFactory().get(connection(config, "meilisearch"));
	return {
		writer: meilisearchWriter(service, { taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS }),
		async prepare(signal) {
			await warnWithoutLegacySearch(service);
			return applyEmbedder(service, config, signal).then(
				() => ({ embedderError: null, indexHasRecords: false }),
				(error: unknown) => embedderFailure(service, error, signal),
			);
		},
		rebuildTaskTimeoutMs: config.search.embedder ? EMBEDDER_TASK_TIMEOUT_MS : DEFAULT_TASK_TIMEOUT_MS,
		async hasRecords() {
			try {
				return (await service.index.getStats()).numberOfDocuments > 0;
			} catch (error) {
				if (error instanceof MeilisearchApiError && error.cause?.code === "index_not_found") return false;
				throw error;
			}
		},
	};
}

async function elasticsearchSetup(config: Config): Promise<SearchWriterSetup> {
	const service = await new RevisionAwareSearchFactory().get(connection(config, "elasticsearch"));
	return {
		writer: elasticsearchWriter(service),
		prepare: async () => ({ embedderError: null, indexHasRecords: false }),
		rebuildTaskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
		async hasRecords() {
			try {
				return (await service.client.count({ index: service.alias })).count > 0;
			} catch (error) {
				if (error instanceof ElasticsearchErrors.ResponseError && error.statusCode === 404) return false;
				throw error;
			}
		},
	};
}

/** The writer for one of the library's engines, with what that engine sets up before it is written to. */
export function openSearchWriter(config: Config, engine: SearchEngineName) {
	return engine === "meilisearch" ? meilisearchSetup(config) : elasticsearchSetup(config);
}
