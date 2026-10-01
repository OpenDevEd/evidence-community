"use server";

import { filterPublicAttachments } from "./tags";

import { Item, ItemGetResponse } from "@/app/api/item/types";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { exportCitationItems } from "@/lib/citation-export";
import {
	getCachedCollections,
	getCachedItemSmall,
} from "@/app/api/cache";
import { getDatabaseForConfig } from "@/db";
import { readReaderListKeys } from "@/lib/readers/data";
import { getSignedInReader } from "@/lib/readers/session";
import { Collection } from "@/app/api/collections/types";
import { z } from "zod";
import { inferParserType } from "nuqs";
import { searchParamsLoader } from "./searchParams";
import type { SmartScreeningField } from "@/types/ai";
import { generateObject } from "ai";
import {
	COUNTRY_HIERARCHY,
	Entry,
} from "@/constants/misc";
import {
	getMainAttributes,
	publicFacetDistribution,
	resolveSearchRequest,
	resolveSearchTopicNodes,
} from "@/lib/search";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimeSearchFacets } from "@/config/library-config/search";
import { AIError } from "@/lib/ai/errors";
import { resolveAIModel } from "@/lib/ai/model-resolution";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { meilisearchEquals, meilisearchIn } from "@/lib/meilisearch-filter";

export async function areLinksValid(links: string[]) {
	const validity = await Promise.allSettled(
		links.map(async (link: string) => {
			const asURL = new URL(link);
			const itemKey = asURL.pathname.split("/").pop();

			if (!itemKey) {
				return false;
			}

			const item = await getCachedItemSmall(itemKey);
			if (!item || !item.item) {
				return false;
			}

			return true;
		}),
	);
	return validity;
}

export async function getItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	userId: string | null = null,
) {
	const collections = searchParams.collections || [];
	const libraryConfig = await getLibraryConfig();

	let readerFilter: string[] = [];
	if (userId) {
		if (!libraryConfig.features.readerAccounts) return { refused: 404 as const };
		const list = await readReaderListKeys(
			await getDatabaseForConfig(libraryConfig),
			{ userId, collectionId: searchParams.collectionId || "" },
			(await getSignedInReader(undefined, libraryConfig))?.id ?? null,
		);
		// Without its filter the search would list the whole library, so a
		// collection the caller may not see is refused instead.
		if ("refused" in list) return list;
		readerFilter = [meilisearchIn("key", list.keys)];
	}

	const facets = getRuntimeSearchFacets(
		libraryConfig.search,
		libraryConfig.filters,
		libraryConfig.topics.enabled,
	);

	return searchIndex(
		searchParams,
		facets,
		[
			...collections.map((collection: string) =>
				meilisearchEquals("collectionsAncestry", collection),
			),
			...readerFilter,
		],
	);
}

export async function convertItem(
	item: Item | Item[],
	format: "ris" | "bibtex",
) {
	const itemsList = Array.isArray(item) ? item : [item];
	const config = await getLibraryConfig();
	return exportCitationItems(
		itemsList,
		format,
		config.citations.showUrl ? config.identity.baseUrl : undefined,
	);
}

/**
 * Not exported: an exported function here becomes a server action anyone can
 * call, and caller-chosen search options could return attachment fields
 * (such as highlighted note text) that the public filter below never sees.
 */
async function searchIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	facets: string[],
	extraFilters: string[],
) {
	const items = async () => {
		const libraryConfig = await getLibraryConfig();
		const topicNodes = await resolveSearchTopicNodes(
			searchParams,
			libraryConfig,
		);
		const {
			attributesToSearchOn,
			country,
			finalFilters: baseFilters,
			limitNum,
			pageNum,
			search,
			sortOption,
		} = resolveSearchRequest(searchParams, libraryConfig, topicNodes);
		const { index: searchIndex } =
			await getMeilisearchForConfig(libraryConfig);
		const finalFilters = [...baseFilters, ...extraFilters];

		const allAttributes = await getMainAttributes(libraryConfig);

		const [searchResults, collections] = await Promise.all([
			searchIndex.search(search, {
				offset: (pageNum - 1) * limitNum,
				limit: limitNum,
				attributesToSearchOn,
				attributesToRetrieve: allAttributes,
				...(sortOption ? { sort: sortOption } : {}),
				facets,
				filter: finalFilters,
			}),
			getCachedCollections(libraryConfig),
		]);

		const items = searchResults.hits;
		const totalCount = searchResults.estimatedTotalHits;

		const itemPromises = items.map(async (item) => {
			if (collections) {
				item.collectionsData = item.collectionsAncestry
					?.map((collection: string) => {
						const collectionData = collections.find(
							(c: Collection) => c.key === collection,
						);
						return collectionData;
					})
					.filter(
						(collectionData: Collection | undefined) =>
							collectionData !== undefined,
					) as Collection[];
			}

			item.attachmentsData = filterPublicAttachments(item.attachmentsData, libraryConfig.content.tags);

			// await setCachedItemSmall(item.key, {
			// 	item: item as Item,
			// });

			return item;
		});

		await Promise.all(itemPromises);

		return {
			items: items as Item[],
			currentPage: pageNum,
			totalItems: totalCount,
			perPage: limitNum,
			totalPages: Math.ceil(totalCount / limitNum),
			facetDistribution: publicFacetDistribution(
				searchResults.facetDistribution,
				facets,
				country,
			),
		};
	};

	return items();
}
