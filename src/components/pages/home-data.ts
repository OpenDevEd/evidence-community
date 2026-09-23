import "server-only";

import type { HomeData } from "./HomePage";
import { getPublicFacets, getPublicItems } from "@/lib/search";
import { getCachedCollections } from "@/app/api/cache";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryHomeConfig } from "@/config/library-config/schema";
import { getComprehensiveStats } from "@/app/[locale]/statistics/queries/get-comprehensive-stats";
import { getMostCitedItems } from "@/app/[locale]/statistics/queries/citation-stats";
import { resolveCitationMeasure } from "@/app/[locale]/statistics/queries/citation-measure";
import { getDatabaseForConfig } from "@/db";
import { item } from "@/db/schema/tables/item";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { itemReview } from "@/db/schema/review";
import { listDigestEditions } from "@/lib/notifications/public";
import { publicItemVisibility, publicParentVisibility } from "@/lib/public-item-visibility";

type Stats = Awaited<ReturnType<typeof getComprehensiveStats>>;

/** Different stored values can read as one name ("en" and "English" are both English); their counts are one row. */
function named(rows: { name: string; count: number }[]) {
	const merged = new Map<string, number>();
	for (const row of rows) if (row.name && row.count > 0) merged.set(row.name, (merged.get(row.name) ?? 0) + row.count);
	return [...merged].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
}

/** What the library holds by subject and place: its top-level collections, its topics, and its countries with their places in the region filter. */
function topicsAndPlaces(stats: Stats | null, facets: Awaited<ReturnType<typeof getPublicFacets>> | null, collections: Awaited<ReturnType<typeof getCachedCollections>>): Pick<HomeData, "countries" | "countryPaths" | "collections" | "topics"> {
	const facetRows = (facets?.facetDistribution ?? {}) as Record<string, Record<string, number>>;
	const countryRows = Object.entries(facetRows.country ?? {})
		.map(([path, count]) => ({ code: path.split(" > ").pop() ?? "", path, count }))
		.filter((row) => /^[A-Z]{2}$/.test(row.code));
	const collectionCounts = facetRows.collectionsAncestry ?? {};
	return {
		countries: Object.fromEntries(countryRows.map((row) => [row.code, row.count])),
		countryPaths: Object.fromEntries(countryRows.map((row) => [row.code, row.path])),
		collections: collections
			.filter((collection) => !collection.parentCollection)
			.map((collection) => ({ key: collection.key, title: collection.title || collection.name || collection.key, count: collectionCounts[collection.key] ?? 0 }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 8),
		topics: (stats?.topicStats ?? [])
			.filter((row) => row.level <= 1 && row.itemCount > 0)
			.map((row) => ({ name: row.topic, count: row.itemCount, key: row.id }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 6),
	};
}

/** Only what the Ask box's example questions are made from, for OpenScholar's Home card. */
export async function loadQuestionFacts() {
	const [stats, facets, collections] = await Promise.all([
		getComprehensiveStats().catch(() => null),
		getPublicFacets({}).catch(() => null),
		getCachedCollections().catch(() => []),
	]);
	return topicsAndPlaces(stats, facets, collections);
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });


/**
 * The language a stored value names. A code counts as its language alone ("en-US" is English: the region says where,
 * not which language); a name written out keeps its words with a capital first letter, so "english" is English.
 */
function languageName(value: string) {
	const text = value.trim();
	const base = text.split(/[-_]/)[0]!.toLowerCase();
	try {
		const name = languageNames.of(base);
		if (name && name.toLowerCase() !== base) return name;
	} catch {
		// Not a language code: a name written out, handled below.
	}
	return text.charAt(0).toUpperCase() + text.slice(1);
}


export async function loadHomeData(now: Date, locale: string, home?: LibraryHomeConfig): Promise<HomeData> {
	const [stats, withPdf, facets, collections, cited, digests, journey] = await Promise.all([
		getComprehensiveStats().catch(() => null),
		// The shelf shows first pages, so it lists the newest records with a PDF: the "full text only" scope.
		getPublicItems({ sort: "desc", scope: "documents" }).catch(() => null),
		getPublicFacets({}).catch(() => null),
		getCachedCollections().catch(() => []),
		mostCited().catch(() => []),
		latestDigests(locale).catch(() => null),
		latestJourney(home?.followed, home?.directory ?? []).catch(() => null),
	]);
	const shelf = withPdf?.items ?? [];
	const covers = await coversOf([...shelf.map((row) => row.key), ...cited.map((row) => row.key), ...(journey ? [journey.key] : [])]).catch(() => ({}) as Record<string, string>);
	return {
		publications: stats?.itemTypes.reduce((sum, row) => sum + row.count, 0) ?? 0,
		authors: stats?.creatorStats.uniqueCreators ?? 0,
		years: (stats?.yearDistribution ?? []).map((row) => ({ year: Number(row.year), count: row.count })).filter((row) => Number.isFinite(row.year) && row.year > 0),
		itemTypes: (stats?.itemTypes ?? []).map((row) => ({ itemType: row.itemType, count: row.count })),
		institutions: named((stats?.institutions ?? []).map((row) => ({ name: row.institution, count: row.itemCount }))),
		...topicsAndPlaces(stats, facets, collections),
		languages: named((stats?.languageDistribution ?? []).map((row) => ({ name: languageName(row.language), count: row.count }))),
		publishers: named((stats?.topPublishers ?? []).map((row) => ({ name: row.publisher, count: row.count }))),
		journals: named((stats?.topJournals ?? []).map((row) => ({ name: row.journal, count: row.count }))),
		covers,
		// A library can switch the full-text scope off, which returns every record; only records whose first page
		// was found go on the shelf either way.
		recent: shelf.filter((row) => covers[row.key]).slice(0, 6),
		journey,
		attachments: stats ? { total: stats.attachmentStats.totalAttachments, itemsWith: stats.attachmentStats.itemsWithAttachments, percentage: stats.attachmentStats.attachmentPercentage } : null,
		citations: stats ? { total: stats.citationStats.totalCitations, itemsWith: stats.citationStats.itemsWithCitations, average: stats.citationStats.avgCitationsPerItem, max: stats.citationStats.maxCitations, percentage: stats.citationStats.citationPercentage, hIndex: stats.citationStats.hIndex } : null,
		collaboration: stats ? { rate: stats.collaborationStats.overallCollaborationRate, collaborative: stats.collaborationStats.collaborativeItems } : null,
		productivity: stats ? { multiple: stats.authorProductivityStats.authorsWithMultipleWorks, average: stats.authorProductivityStats.avgItemsPerAuthor, max: stats.authorProductivityStats.maxItemsPerAuthor } : null,
		cited,
		ai: isLibraryFeatureEnabled((await getLibraryConfig()).features, "aiSearch"),
		digests,
		updated: now,
	};
}

/**
 * The publication the steps follow (the chosen one, else the most recent submission an editor published): when it
 * came in, who approved it and when, and its DOI. Reviews record the approving editor's OpenScholar account, named
 * from the directory OpenScholar fills in; someone no longer on the team goes unnamed. The submitter is often an
 * author outside the library, so only the date is shown for them.
 */
async function latestJourney(followed: string | undefined, directory: LibraryHomeConfig["directory"]): Promise<HomeData["journey"]> {
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const [row] = await db
		.select({ key: itemReview.itemKey, submittedAt: itemReview.submittedAt, resolvedAt: itemReview.resolvedAt, resolvedBy: itemReview.resolvedBy, title: item.title, doi: item.DOI })
		.from(itemReview)
		.innerJoin(item, eq(item.key, itemReview.itemKey))
		.where(and(eq(itemReview.state, "published"), publicParentVisibility(db, config.content.tags.hidden), followed ? eq(itemReview.itemKey, followed) : undefined))
		// Two approvals saved in the same millisecond still give one answer.
		.orderBy(desc(itemReview.resolvedAt), desc(itemReview.submittedAt), desc(itemReview.id))
		.limit(1);
	if (!row?.resolvedAt || !row.title) return null;
	const reviewer = directory.find((person) => person.id === row.resolvedBy);
	return { key: row.key, title: row.title, submittedAt: row.submittedAt.toISOString(), reviewer: reviewer ? { name: reviewer.name, photo: reviewer.photo ?? null } : null, publishedAt: row.resolvedAt.toISOString(), doi: row.doi || null };
}

/** First pages of the given publications' PDFs, from their attachments. */
async function coversOf(keys: string[]): Promise<Record<string, string>> {
	if (keys.length === 0) return {};
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const rows = await db
		.select({ parent: item.parentItem, cover: item.PDFCoverPageImage })
		.from(item)
		.where(and(inArray(item.parentItem, keys), publicItemVisibility(db, config.content.tags.hidden), isNotNull(item.PDFCoverPageImage)));
	return Object.fromEntries(rows.flatMap((row) => (row.parent && row.cover ? [[row.parent, row.cover]] : [])));
}

async function mostCited() {
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const { measure } = await resolveCitationMeasure(db, undefined);
	return getMostCitedItems(db, measure, 3, config.content.tags.hidden);
}

async function latestDigests(locale: string): Promise<HomeData["digests"]> {
	const config = await getLibraryConfig();
	const { editions } = await listDigestEditions(await getDatabaseForConfig(config), config, locale);
	return editions.length > 0 ? { library: config.identity.name, timezone: config.notifications.schedule.timezone, editions: editions.slice(0, 3) } : null;
}
