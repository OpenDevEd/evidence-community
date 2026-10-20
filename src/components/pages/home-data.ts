import "server-only";

import type { HomeData } from "./HomePage";
import { getPublicFacets, getPublicItems, getPublicItemsByKeys } from "@/lib/search";
import { defaultParams } from "@/lib/utils";
import { examplesKey, firstFilters, listedRows } from "./home-explorer";
import { getCachedCollections } from "@/app/api/cache";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryHomeConfig, LibraryServerConfig } from "@/config/library-config/schema";
import { staleWhileRevalidate } from "@/lib/stale-while-revalidate";
import { getComprehensiveStats, peekComprehensiveStats } from "@/app/[locale]/statistics/queries/get-comprehensive-stats";
import { getDatabaseForConfig, type Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { and, count, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { sourceConnection, sourceRecordAlias } from "@/db/schema/source";
import { openAlexConnectionConfigSchema } from "@/lib/source-ingestion/openalex/schema";
import { queryTerms } from "@/lib/source-ingestion/openalex/query-terms";
import { itemReview } from "@/db/schema/review";
import { listDigestEditions } from "@/lib/notifications/public";
import { publicItemVisibility, publicParentVisibility } from "@/lib/public-item-visibility";
import { normalizeDoi } from "@/lib/doi";
import { listReviewedPublications } from "@/lib/admin/reviewed-publication-catalog";

type Stats = NonNullable<Awaited<ReturnType<typeof peekComprehensiveStats>>>;

/** A part of the page that failed shows empty rather than breaking the page, and the failure is logged. */
function fallback<T>(part: string, value: T) {
	return (error: unknown) => {
		console.error(`Home page: the ${part} could not be read`, error);
		return value;
	};
}

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
			.filter((collection) => collection.count > 0)
			.sort((a, b) => b.count - a.count)
			.slice(0, 8),
		topics: (stats?.openAlexTopicStats ?? [])
			.filter((row) => row.level <= 1 && row.itemCount > 0)
			.map((row) => ({ name: row.topic, count: row.itemCount, key: row.id }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 6),
	};
}

/**
 * Only what the Ask box's example questions are made from, for OpenScholar's Home card. It answers once, so it waits
 * for the statistics rather than suggest from a cold cache.
 */
export async function loadQuestionFacts() {
	const [stats, facets, collections] = await Promise.all([
		getComprehensiveStats().catch(fallback("statistics", null)),
		getPublicFacets({}).catch(fallback("facets", null)),
		getCachedCollections().catch(fallback("collections", [])),
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


/** The library's counts from its cached statistics; without them every count is empty. */
function figuresFrom(stats: Stats | null, now: Date): Omit<HomeData, "countries" | "countryPaths" | "collections" | "topics" | "covers" | "recent" | "journey" | "pipeline" | "cited" | "copies" | "examples" | "ai" | "digests"> {
	if (!stats) return { publications: 0, authors: 0, years: [], itemTypes: [], institutions: [], languages: [], publishers: [], journals: [], attachments: null, citations: null, collaboration: null, productivity: null, updated: now };
	const { attachmentStats: attachments, citationStats: citations, collaborationStats: collaboration, authorProductivityStats: productivity } = stats;
	return {
		publications: stats.itemTypes.reduce((sum, row) => sum + row.count, 0),
		authors: stats.creatorStats.uniqueCreators,
		years: stats.yearDistribution.map((row) => ({ year: Number(row.year), count: row.count })).filter((row) => Number.isFinite(row.year) && row.year > 0),
		itemTypes: stats.itemTypes.map((row) => ({ itemType: row.itemType, count: row.count })),
		institutions: named(stats.institutions.map((row) => ({ name: row.institution, count: row.itemCount }))),
		languages: named(stats.languageDistribution.map((row) => ({ name: languageName(row.language), count: row.count }))),
		publishers: named(stats.topPublishers.map((row) => ({ name: row.publisher, count: row.count }))),
		journals: named(stats.topJournals.map((row) => ({ name: row.journal, count: row.count }))),
		attachments: { total: attachments.totalAttachments, itemsWith: attachments.itemsWithAttachments, withPdf: attachments.itemsWithPdf, percentage: attachments.attachmentPercentage },
		citations: { total: citations.totalCitations, itemsWith: citations.itemsWithCitations, average: citations.avgCitationsPerItem, max: citations.maxCitations, percentage: citations.citationPercentage, hIndex: citations.hIndex },
		collaboration: { rate: collaboration.overallCollaborationRate, collaborative: collaboration.collaborativeItems },
		productivity: { multiple: productivity.authorsWithMultipleWorks, average: productivity.avgItemsPerAuthor, max: productivity.maxItemsPerAuthor },
		// When the figures were counted, which for cached statistics is not today.
		updated: new Date(stats.computedAt),
	};
}

/**
 * Everything the home page shows below its heading. Nothing in it depends on the visitor, so every visitor gets the
 * last copy at once, and after a minute a fresh one is counted behind the page. Only the first visit after a start
 * waits. A new configuration revision is a new key; clearing the public cache forgets it.
 */
export async function loadHomeData(locale: string, config: LibraryServerConfig): Promise<HomeData> {
	// The key and the home settings come from the same snapshot, so a publish in between cannot mix them.
	return staleWhileRevalidate(`home:${config.revision}:${locale}`, 60_000, (previous) =>
		countHomeData(new Date(), locale, config.home, previous),
	);
}

async function countHomeData(now: Date, locale: string, home: LibraryHomeConfig | undefined, previous: HomeData | undefined): Promise<HomeData> {
	// A part that fails shows empty. When an earlier copy exists, the whole earlier copy stays instead, so a passing
	// failure does not empty the page for the next minute.
	let failed = false;
	const soft = <T>(part: string, value: T) => {
		const log = fallback(part, value);
		return (error: unknown) => {
			failed = true;
			return log(error);
		};
	};
	const [stats, withPdf, facets, collections, cited, digests, journey, pipeline] = await Promise.all([
		peekComprehensiveStats().catch(soft("statistics", null)),
		// The shelf shows first pages, so it lists the newest records with a PDF: the "full text only" scope.
		getPublicItems({ sort: "desc", scope: "documents" }).catch(soft("newest publications", null)),
		getPublicFacets({}).catch(soft("facets", null)),
		getCachedCollections().catch(soft("collections", [])),
		mostCited().catch(soft("most cited", [])),
		latestDigests(locale).catch(soft("digests", null)),
		latestJourney(home?.followed, home?.directory ?? []).catch(soft("followed publication", null)),
		pipelineFigures(home, now).catch(soft("source figures", null)),
	]);
	const shelf = withPdf?.items ?? [];
	const config = await getLibraryConfig();
	const figures = { ...figuresFrom(stats, now), ...topicsAndPlaces(stats, facets, collections) };
	const listed = [...cited.map((row) => row.key), ...(journey ? [journey.key] : [])];
	const [covers, copies, examples] = await Promise.all([
		coversOf([...shelf.map((row) => row.key), ...listed]).catch(soft("covers", {} as Record<string, string>)),
		getPublicItemsByKeys(listed).catch(soft("most cited and followed publications", [])),
		rowExamples(firstFilters(listedRows(figures, config, now.toISOString()))).catch(soft("explorer publications", {})),
	]);
	if (failed && previous) return previous;
	return {
		...figures,
		covers,
		copies,
		examples,
		// A library can switch the full-text scope off, which returns every record; only records whose first page
		// was found go on the shelf either way.
		// Up to eighteen, so the hero's three columns each show their own first pages; the publications row shows six.
		recent: shelf.filter((row) => covers[row.key]).slice(0, 18),
		journey,
		pipeline,
		// The list can be minutes old: a record hidden since then has no public copy and leaves it.
		cited: cited.filter((row) => copies.some((copy) => copy.key === row.key)),
		ai: isLibraryFeatureEnabled(config.features, "aiSearch"),
		digests,
	};
}

/**
 * The newest two publications of the row each explorer view opens on, as the explorer would ask the listing for them,
 * so the first cards of every view come with the page. One small search per view, side by side.
 */
async function rowExamples(filters: string[]): Promise<HomeData["examples"]> {
	return Object.fromEntries(await Promise.all(filters.map(async (filter) => [examplesKey(filter), await getPublicItems(defaultParams(new URLSearchParams(`${filter}&sort=desc`)), { perPage: 2 })] as const)));
}

/**
 * The publication the steps follow (the chosen one, else the most recent submission an editor published): when it
 * came in, who approved it and when, and its DOI. Reviews record the approving editor's OpenScholar account, named
 * from the directory OpenScholar fills in; someone no longer on the team goes unnamed. The submitter is often an
 * author outside the library, so only the date is shown for them. Not every library reviews: a chosen publication
 * that was never reviewed, or with nothing reviewed the newest one with a PDF, is followed from when it was added.
 */
async function latestJourney(followed: string | undefined, directory: LibraryHomeConfig["directory"]): Promise<HomeData["journey"]> {
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const hidden = config.content.tags.hidden;
	// An unreviewed publication is followed only while it still has a public PDF, as the picker required.
	return (await reviewedJourney(db, hidden, followed, directory)) ?? addedJourney(db, hidden, (await listReviewedPublications(db, followed ? { ids: followed } : { pageSize: "1" }, hidden)).items[0]?.key);
}

async function reviewedJourney(db: Database, hidden: readonly string[], followed: string | undefined, directory: LibraryHomeConfig["directory"]): Promise<HomeData["journey"]> {
	const [row] = await db
		.select({ key: itemReview.itemKey, submittedAt: itemReview.submittedAt, resolvedAt: itemReview.resolvedAt, resolvedBy: itemReview.resolvedBy, title: item.title, doi: item.DOI })
		.from(itemReview)
		.innerJoin(item, eq(item.key, itemReview.itemKey))
		.where(and(eq(itemReview.state, "published"), publicParentVisibility(db, hidden), followed ? eq(itemReview.itemKey, followed) : undefined))
		// Two approvals saved in the same millisecond still give one answer.
		.orderBy(desc(itemReview.resolvedAt), desc(itemReview.submittedAt), desc(itemReview.id))
		.limit(1);
	if (!row?.resolvedAt) return null;
	const reviewer = directory.find((person) => person.id === row.resolvedBy);
	return { key: row.key, title: row.title || row.key, reviewed: true, submittedAt: row.submittedAt.toISOString(), reviewer: reviewer ? { name: reviewer.name, photo: reviewer.photo ?? null } : null, publishedAt: row.resolvedAt.toISOString(), doi: normalizeDoi(row.doi) };
}

/** A publication that went public as it was added, with no review to date its steps. */
async function addedJourney(db: Database, hidden: readonly string[], key: string | undefined): Promise<HomeData["journey"]> {
	if (!key) return null;
	const [row] = await db
		.select({ key: item.key, title: item.title, dateAdded: item.dateAdded, createdAt: item.createdAt, doi: item.DOI })
		.from(item)
		.where(and(eq(item.key, key), publicParentVisibility(db, hidden)))
		.limit(1);
	if (!row) return null;
	const when = (row.dateAdded ?? row.createdAt).toISOString();
	return { key: row.key, title: row.title || row.key, reviewed: false, submittedAt: when, reviewer: null, publishedAt: when, doi: normalizeDoi(row.doi) };
}

const COUNTED_STEPS = new Set(["search", "sync", "duplicates"]);

/** What the steps that count the library's OpenAlex searches show; read only when the home page has such a step. */
async function pipelineFigures(home: LibraryHomeConfig | undefined, now: Date): Promise<HomeData["pipeline"]> {
	if (!home?.curation.steps.some((step) => COUNTED_STEPS.has(step.type))) return null;
	const config = await getLibraryConfig();
	const db = await getDatabaseForConfig(config);
	const sources = await db
		.select({ key: sourceConnection.key, config: sourceConnection.config })
		.from(sourceConnection)
		.where(and(eq(sourceConnection.provider, "openalex"), eq(sourceConnection.status, "active")));
	const keys = sources.map((source) => source.key);
	const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
	// New records count whatever brought them in; only the search and its repeats need an OpenAlex search.
	const [[added], [merged]] = await Promise.all([
		db.select({ count: count() }).from(item).where(and(publicParentVisibility(db, config.content.tags.hidden), gte(item.createdAt, monthAgo))),
		keys.length > 0
			? db.select({ count: count() }).from(sourceRecordAlias).where(and(inArray(sourceRecordAlias.sourceConnectionKey, keys), eq(sourceRecordAlias.kind, "duplicate-of")))
			: [{ count: 0 }],
	]);
	const queries = sources.flatMap((source) => openAlexConnectionConfigSchema.safeParse(source.config).data?.approvedQuery.query ?? []);
	return { ...queryTerms(queries), added: added?.count ?? 0, merged: merged?.count ?? 0 };
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

/** The first three publications of the "Most cited" sort that anything cites. */
async function mostCited() {
	const { items } = await getPublicItems({ sort: "mostCited" }, { perPage: 3 });
	return items.flatMap((row) =>
		row.citationCount ? [{ key: row.key, title: row.title || row.key, citations: row.citationCount }] : [],
	);
}

async function latestDigests(locale: string): Promise<HomeData["digests"]> {
	const config = await getLibraryConfig();
	const { editions } = await listDigestEditions(await getDatabaseForConfig(config), config, locale);
	return editions.length > 0 ? { library: config.identity.name, editions: editions.slice(0, 3) } : null;
}

/** The library's latest digests for the listing's sidebar, counted again at most once a minute. */
export async function loadLatestDigests(locale: string): Promise<HomeData["digests"]> {
	const config = await getLibraryConfig();
	return staleWhileRevalidate(`digests:${config.revision}:${locale}`, 60_000, () =>
		latestDigests(locale).catch(fallback("digests", null)),
	);
}
