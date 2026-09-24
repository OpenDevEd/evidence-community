import { createHash } from "node:crypto";
import {
	type ComprehensiveStats,
	getInstitutionStats,
	getInstitutionStatsByYear,
	getTotalItems,
	getAvailableYears,
	getItemTypeStats,
	getYearDistribution,
	getCitationStats,
	getCreatorStats,
	getFieldCompleteness,
	getAttachmentStats,
	getPublishersAndJournals,
	getRecentActivity,
	getAuthorCountries,
	getAuthorProductivityStats,
	getAuthorCollaborationStats,
	getDetailedAuthorStats,
	getCollaborationStats,
	getTopicStats,
	getTopicStatsByYear,
	getOpenAlexTopicStats,
	getCitationsByYear,
} from "./index";
import { withMeilisearchCache } from "@/lib/cache-utils";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { resolveCitationMeasure } from "./citation-measure";
import { getCachedCollections } from "@/app/api/cache";
import type { Collection } from "@/app/api/collections/types";
import type { ShownCollections } from "./topic-stats";

/** Part of the cache key: raise it when the statistics change what they count, so a deployment never serves figures cached by the code before it. */
const STATISTICS_VERSION = 6;

export async function getComprehensiveStats(
	requestedCitationMeasure?: string,
): Promise<ComprehensiveStats> {
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	// Statistics count what a reader could find in the library, nothing hidden from it.
	const hidden = config.content.tags.hidden;
	const { measure, options } = await resolveCitationMeasure(
		db,
		requestedCitationMeasure,
	);
	// No fallback: statistics computed without the collections would be cached with every topic missing.
	const shown = shownCollections(await getCachedCollections(config));
	// Topics are named from the shown collections, so renaming or moving one counts afresh.
	const collectionsFingerprint = createHash("sha256")
		.update(JSON.stringify([...shown]))
		.digest("hex")
		.slice(0, 16);
	const stats = await withMeilisearchCache(
		config,
		`${config.revision}-comprehensive-stats-v${STATISTICS_VERSION}-${collectionsFingerprint}-${measure.key}`,
		async () => {
			const totalItems = await getTotalItems(db, hidden);

			const [
				institutions,
				institutionsByYear,
				availableYears,
				itemTypes,
				yearDistribution,
				citationStats,
				creatorStats,
				fieldCompleteness,
				attachmentStats,
				publishersAndJournals,
				recentActivity,
				authorCountries,
				authorProductivityStats,
				authorCollaborationStats,
				detailedAuthorStats,
				topicData,
				collectionsByYear,
				openAlexTopicData,
				citationsByYear,
			] = await Promise.all([
				getInstitutionStats(db, measure, hidden),
				getInstitutionStatsByYear(db, measure, hidden),
				getAvailableYears(db, hidden),
				getItemTypeStats(db, totalItems, hidden),
				getYearDistribution(db, hidden),
				getCitationStats(db, measure, hidden),
				getCreatorStats(db, hidden),
				getFieldCompleteness(db, totalItems, hidden),
				getAttachmentStats(db, totalItems, hidden),
				getPublishersAndJournals(db, hidden),
				getRecentActivity(db, hidden),
				getAuthorCountries(db, measure, hidden),
				getAuthorProductivityStats(db, hidden),
				getAuthorCollaborationStats(db, hidden),
				getDetailedAuthorStats(db, measure, hidden),
				getTopicStats(db, measure, shown, hidden),
				getTopicStatsByYear(db, measure, shown, hidden),
				getOpenAlexTopicStats(db, config, measure, hidden),
				getCitationsByYear(db, measure, hidden),
			]);

			const collaborationStats = await getCollaborationStats(
				db,
				authorCountries,
				hidden,
			);

			return {
				computedAt: new Date().toISOString(),
				institutions,
				institutionsByYear,
				collectionsByYear,
				openAlexTopicsByYear: openAlexTopicData.topicsByYear,
				availableYears,
				itemTypes,
				yearDistribution,
				citationStats,
				creatorStats,
				fieldCompleteness,
				attachmentStats,
				authorCountries,
				collaborationStats,
				authorStats: detailedAuthorStats,
				authorProductivityStats,
				authorCollaborationStats,
				topPublishers: publishersAndJournals.topPublishers,
				topJournals: publishersAndJournals.topJournals,
				languageDistribution:
					publishersAndJournals.languageDistribution,
				recentActivity,
				topicStats: topicData.topicStats,
				topicOverview: topicData.topicOverview,
				openAlexTopicStats: openAlexTopicData.topicStats,
				openAlexTopicOverview: openAlexTopicData.topicOverview,
				citationsByYear,
			};
		},
	);
	return {
		...stats,
		citationMeasure: { selectedKey: measure.key, options },
	};
}

/**
 * Every collection the library shows, nested ones included, by key with its public name and parent. A shown root is
 * named by its configured title; the hierarchy copies that title onto every collection below it, so those go by their
 * own names.
 */
function shownCollections(
	collections: readonly Collection[],
): ShownCollections {
	// The cached collections are already flat, every level listed.
	return new Map(
		collections.map((collection) => [
			collection.key,
			{
				title: publicTitle(collection),
				parent: collection.parentCollection || undefined,
			},
		]),
	);
}

function publicTitle(collection: Collection) {
	const title = collection.parentCollection
		? collection.name
		: collection.title || collection.name;
	return title || collection.key;
}
