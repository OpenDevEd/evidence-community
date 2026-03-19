import meilisearch from "@/lib/meilisearch";

const CACHE_INDEX = "cache";

function getDocumentId(key: string) {
	return process.env.MEILI_INDEX + "-" + key;
}

export async function withMeilisearchCache<T>(key: string, compute: () => Promise<T>): Promise<T> {
	const docId = getDocumentId(key);

	try {
		const result = await meilisearch.index(CACHE_INDEX).getDocument(docId);
		return JSON.parse(result.content);
	} catch {
		// Cache miss — compute fresh data
	}

	const data = await compute();

	try {
		await meilisearch.index(CACHE_INDEX).addDocuments([
			{ id: docId, content: JSON.stringify(data) },
		]);
	} catch {
		// Cache write failure is non-fatal
	}

	return data;
}
