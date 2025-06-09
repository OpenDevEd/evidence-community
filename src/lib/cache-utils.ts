import { NextResponse } from "next/server";
import { after } from "next/server";
import meilisearch from "@/lib/meilisearch";

export interface CacheConfig {
	cacheKey: string;
	expirationHours?: number;
	expirationMinutes?: number;
}

async function ensureCacheIndexExists(index: string) {
	try {
		const indexCreation = await meilisearch.createIndex(index);
		await meilisearch.tasks.waitForTask(indexCreation.taskUid);
	} catch (indexError) {
		// Index might already exist, continue
	}
}

async function getCachedData<T>(index: string, contentDocumentId: string): Promise<T | null> {
	try {
		const cachedResult = await meilisearch.index(index).getDocument(contentDocumentId);
        console.log(`💾 Received cached data size: ${cachedResult.content.length} bytes`);
		return JSON.parse(cachedResult.content);
	} catch (error) {
		return null;
	}
}

async function getCacheTimestamp(index: string, timestampDocumentId: string): Promise<Date | null> {
	try {
		const timestampResult = await meilisearch.index(index).getDocument(timestampDocumentId);
		return new Date(timestampResult.content);
	} catch (error) {
		return null;
	}
}

async function saveCacheData<T>(
	index: string,
	contentDocumentId: string,
	timestampDocumentId: string,
	data: T,
	isBackground = false
) {
	const prefix = isBackground ? "Background: " : "";
	const now = new Date().toISOString();
	
    // print data size
    const dataSize = JSON.stringify(data).length;
    console.log(`💾 Data size: ${dataSize} bytes`);
	console.log(`💾 ${prefix}Caching data for ${contentDocumentId}...`);
	await meilisearch.index(index).addDocuments([
		{
			id: contentDocumentId,
			content: JSON.stringify(data),
		},
		{
			id: timestampDocumentId,
			content: now,
		},
	]);
	console.log(`✅ ${prefix}Data cached successfully for ${contentDocumentId}`);
}

async function updateCacheInBackground<T>(
	index: string,
	contentDocumentId: string,
	timestampDocumentId: string,
	fetchDataFunction: () => Promise<T>
) {
	try {
		console.log(`🔄 Background: Fetching fresh data for ${contentDocumentId}...`);
		
		await ensureCacheIndexExists(index);
		const freshData = await fetchDataFunction();
		await saveCacheData(index, contentDocumentId, timestampDocumentId, freshData, true);

	} catch (error) {
		console.error(`❌ Background: Error updating cache for ${contentDocumentId}:`, error);
	}
}

/**
 * Generic cache-first function with stale-while-revalidate pattern
 * @param fetchDataFunction - Function that fetches fresh data
 * @param config - Cache configuration
 * @param responseTransformer - Optional function to transform data before returning
 */
export async function withCache<T, R = T>(
	fetchDataFunction: () => Promise<T>,
	config: CacheConfig,
	responseTransformer?: (data: T) => R
): Promise<R> {
	const index = "cache";
	const contentDocumentId = process.env.MEILI_INDEX + `-${config.cacheKey}`;
	const timestampDocumentId = process.env.MEILI_INDEX + `-${config.cacheKey}-timestamp`;
	
	// Calculate expiration in minutes - prioritize expirationMinutes if provided
	const expirationMinutes = config.expirationMinutes ?? (config.expirationHours ?? 24) * 60;

	console.log(`📊 Checking cache timestamp for ${config.cacheKey}...`);
	
	// First, only check if we have a valid timestamp
	const lastUpdated = await getCacheTimestamp(index, timestampDocumentId);

	// If no timestamp exists, skip cache entirely
	if (!lastUpdated) {
		console.log(`🔄 No cache timestamp found for ${config.cacheKey}, fetching fresh data...`);
		// Jump to fresh data fetch
	} else {
		// We have a timestamp, check if cache is valid
		const now = new Date();
		const minutesDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60);
		const hoursDiff = minutesDiff / 60;
		const ageDisplay = minutesDiff < 60 
			? `${minutesDiff.toFixed(1)} minutes old`
			: `${hoursDiff.toFixed(1)} hours old`;

		if (minutesDiff < expirationMinutes) {
			console.log(`✅ Cache is fresh (${ageDisplay}) for ${config.cacheKey}, fetching cached data...`);
		} else {
			console.log(`⏰ Cache is stale (${ageDisplay}) for ${config.cacheKey}, fetching stale data and refreshing in background...`);
		}

		// Only now fetch the cached data since we know we'll use it
		const cachedData = await getCachedData<T>(index, contentDocumentId);
		
		if (cachedData) {
			// If cache is stale, schedule background update
			if (minutesDiff >= expirationMinutes) {
				after(async () => {
					await updateCacheInBackground(index, contentDocumentId, timestampDocumentId, fetchDataFunction);
				});
			}
			
			const responseData = responseTransformer ? responseTransformer(cachedData) : cachedData;
			return responseData as R;
		} else {
			console.log(`❌ Cache timestamp exists but data is missing for ${config.cacheKey}, fetching fresh data...`);
		}
	}

	// No valid cache found, fetch fresh data synchronously
	console.log(`🔄 Fetching fresh data synchronously for ${config.cacheKey}...`);
	
	try {
		await ensureCacheIndexExists(index);
		const freshData = await fetchDataFunction();
		await saveCacheData(index, contentDocumentId, timestampDocumentId, freshData);
		
		const responseData = responseTransformer ? responseTransformer(freshData) : freshData;
		return responseData as R;

	} catch (fetchError) {
		console.error(`Error fetching data for ${config.cacheKey}:`, fetchError);
		throw new Error(`Failed to fetch ${config.cacheKey}: ${fetchError}`);
	}
}

/**
 * Manually invalidate cache for a specific key
 */
export async function invalidateCache(cacheKey: string): Promise<void> {
	const index = "cache";
	const contentDocumentId = process.env.MEILI_INDEX + `-${cacheKey}`;
	const timestampDocumentId = process.env.MEILI_INDEX + `-${cacheKey}-timestamp`;

	try {
		await meilisearch.index(index).deleteDocuments([contentDocumentId, timestampDocumentId]);
		console.log(`🗑️ Cache invalidated for ${cacheKey}`);
	} catch (error) {
		console.error(`❌ Error invalidating cache for ${cacheKey}:`, error);
	}
} 