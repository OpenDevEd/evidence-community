"use server";

import { filterPublicAttachments, heldPdf } from "./attachment-visibility";
import { publicTagRules } from "./tags";

import { Item, ItemGetResponse } from "@/app/api/item/types";
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
	pagePosition,
	publicFacetDistribution,
	publicFields,
	resolveSearchRequest,
	resolveSearchTopicNodes,
} from "@/lib/search";
import { fieldIn, searchOrder, type SearchFilter } from "@/lib/search-engine";
import { getSearchEngine } from "@/lib/search-engines";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimeSearchFacets } from "@/config/library-config/search";
import { AIError } from "@/lib/ai/errors";
import { resolveAIModel } from "@/lib/ai/model-resolution";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";

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

	let readerFilter: SearchFilter[] = [];
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
		readerFilter = [fieldIn("key", list.keys)];
	}

	const facets = getRuntimeSearchFacets(
		libraryConfig.search,
		libraryConfig.filters,
		libraryConfig.topics.enabled,
	);

	return searchIndex(
		searchParams,
		facets,
		// The collections are in the search's own filters, matched as the library and reader choose.
		readerFilter,
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
	extraFilters: SearchFilter[],
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
			authorCountry,
			finalFilters: baseFilters,
			limitNum,
			pageNum,
			search,
			sortOption,
		} = resolveSearchRequest(searchParams, libraryConfig, topicNodes);
		const finalFilters = [...baseFilters, ...extraFilters];
		const engine = await getSearchEngine(libraryConfig);
		const position = pagePosition(pageNum, limitNum, searchParams, searchOrder(engine.name, { text: search, sort: sortOption }));

		const [searchResults, collections] = await Promise.all([
			engine.search<Item>({
				text: search,
				fields: attributesToSearchOn,
				filters: finalFilters,
				sort: sortOption,
				size: limitNum,
				returned: publicFields(libraryConfig),
				facets,
				...position.start,
			}),
			getCachedCollections(libraryConfig),
		]);

		const items = searchResults.hits;
		const totalCount = searchResults.total;

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

			const rules = publicTagRules(libraryConfig);
			item.heldPdf = heldPdf(item, rules);
			item.attachmentsData = filterPublicAttachments(item, rules);

			// await setCachedItemSmall(item.key, {
			// 	item: item as Item,
			// });

			return item;
		});

		await Promise.all(itemPromises);

		return {
			items: items as Item[],
			currentPage: position.page,
			totalItems: totalCount,
			perPage: limitNum,
			totalPages: Math.ceil(totalCount / limitNum),
			facetDistribution: publicFacetDistribution(
				searchResults.facets,
				facets,
				{ country, author_country: authorCountry },
			),
		};
	};

	return items();
}
