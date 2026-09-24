"use server";

import { filterPublicAttachments } from "./tags";

import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { InferSelectModel } from "drizzle-orm";
import { Session } from "next-auth";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { exportCitationItems } from "@/lib/citation-export";
import {
	getCachedCollections,
	getCachedItemSmall,
	getUserCollectionKeysDirect,
	getUserLikesDirect,
} from "@/app/api/cache";
import { auth } from "@/app/api/auth/[...nextauth]/config";
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
import type { CredentialsInput } from "@/lib/auth-credentials";
import { authorizeForConfig } from "@/lib/auth-service";
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

export async function authorize(
	props: CredentialsInput,
): Promise<{ error: string } | { success: true }> {
	const result = await authorizeForConfig(props, await getLibraryConfig());
	return "error" in result ? result : { success: true };
}

export async function getItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	userId: string | null = null,
) {
	const collections = searchParams.collections || [];
	const libraryConfig = await getLibraryConfig();

	const userFilters = await getProfileSearchFilter(
		userId,
		searchParams.collectionId || "",
	);

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
			...(userFilters?.filter ? userFilters.filter : []),
		],
	);
}

export async function getProfileSearchFilter(
	id: string | null,
	collectionId: string | null,
) {
	if (!collectionId && !id) {
		return { filter: null };
	}

	const [session, collectionKeys, likes] = (await Promise.all([
		auth(),
		collectionId ? getUserCollectionKeysDirect(collectionId) : null,
		id && !collectionId ? getUserLikesDirect(id) : null,
	])) as [Session | null, any, any];

	if (collectionKeys) {
		if (!collectionKeys) {
			return { filter: null };
		}

		if (collectionKeys.private) {
			const userId = session?.user?.id;

			if (!id) {
				return { filter: null, status: 401 };
			}

			if (collectionKeys.userId !== userId) {
				return { filter: null, status: 403 };
			}
		}

		return {
			filter: [meilisearchIn("key", collectionKeys.itemKeys)],
		};
	}

	if (likes) {
		return {
			filter: [
				meilisearchIn(
					"key",
					likes
						.filter(
							(like: InferSelectModel<typeof usersToLikes>) =>
								!like.deleted,
						)
						.map(
							(like: InferSelectModel<typeof usersToLikes>) =>
								like.itemKey,
						),
				),
			],
		};
	}

	return { filter: null };
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
				...(sortOption ? { sort: [sortOption] } : {}),
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
