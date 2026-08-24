"use server";

import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { InferSelectModel } from "drizzle-orm";
import { Session } from "next-auth";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { BibTeXExporter } from "@/lib/formatAsBibTeX";
import { generateRandomID } from "@/lib/utils";
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
import { headers } from "next/headers";
import { COUNTRY_HIERARCHY, countryFacetOptions, Entry } from "@/constants/misc";
import { FacetDistribution } from "meilisearch";
import { addRegionsToFacetDistribution } from "./country";
import { getMainAttributes, resolveSearchRequest } from "@/lib/search";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimeSearchFacets } from "@/config/library-config/search";
import { AIError } from "@/lib/ai/errors";
import { resolveAIModel } from "@/lib/ai/model-resolution";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { CredentialsInput } from "@/lib/auth-credentials";
import { authorizeForConfig } from "@/lib/auth-service";
import { getAIRateLimitStatus } from "@/lib/ai-rate-limit";
import { meilisearchEquals, meilisearchIn } from "@/lib/meilisearch-filter";

export async function getRateLimits() {
	const headersList = await headers();
	const status = getAIRateLimitStatus(headersList);

	return {
		retryAt: status.resetAt,
		remaining: status.remaining,
		limit: status.limit,
		retryAfter: status.allowed ? null : status.retryAfter,
	}
}

export async function areLinksValid(links: string[]) {
	const validity = await Promise.allSettled(links.map(async (link: string) => {
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
	}));
	return validity;
}

export async function runScreening(
	keys: string[],
	modelId: string,
	smartScreeningFields: SmartScreeningField[],
) {
	const libraryConfig = await getLibraryConfig();
	if (!isLibraryFeatureEnabled(libraryConfig.features, "ai")) {
		return { error: "AI is disabled" };
	}

	let selectedModel;
	try {
		selectedModel = await resolveAIModel(libraryConfig, modelId);
	} catch (error) {
		if (error instanceof AIError) {
			return { error: error.message };
		}
		throw error;
	}

	if (!keys || keys.length === 0) {
		return { error: "No keys provided" };
	}

	const allItems = await Promise.allSettled(keys.map(async (key: string): Promise<ItemGetResponse["item"] | null> => {
		const item = await getCachedItemSmall(key);
		if (!item || !item.item) {
			return null;
		}
		return {
			...item.item,
			fullTextPDFs: undefined,
		}
	}));

	const items = allItems.filter(result => result.status === "fulfilled" && result.value).map(result => (result as PromiseFulfilledResult<any>).value).filter((item) => item.abstractNote && item.abstractNote.length > 0)
		.map((item: ItemGetResponse["item"]) => ({
			title: item?.title,
			abstractNote: item?.abstractNote,
			key: item?.key,
		}));

	const fieldMaps = new Map<string, string>();

	const screeningFieldsSchema = z.object(
		smartScreeningFields.reduce((acc: Record<string, z.ZodTypeAny>, field: SmartScreeningField) => {
			const fieldKey = field.label.trim();
			const randomKey = generateRandomID();
			fieldMaps.set(randomKey, fieldKey);
			switch (field.type.trim()) {
				case 'number':
					acc[randomKey] = z.number().describe(field.description);
					break;
				case 'boolean':
					acc[randomKey] = z.boolean().describe(field.description);
					break;
				case 'string':
				default:
					acc[randomKey] = z.string().describe(field.description);
					break;
			}
			return acc;
		}, {} as Record<string, z.ZodTypeAny>) // Use ZodTypeAny to allow different types
	);

	// Process items in parallel chunks of 10
	const resultObject: Record<string, any> = {};
	const CHUNK_SIZE = 25;

	// Split items into chunks
	const chunks = [];
	for (let i = 0; i < items.length; i += CHUNK_SIZE) {
		chunks.push(items.slice(i, i + CHUNK_SIZE));
	}

	// Process each chunk in parallel
	for (const chunk of chunks) {
		const chunkPromises = chunk.map(async (item) => {
			try {
				// Create schema for a single item
				const singleItemSchema = z.object({
					screeningFields: screeningFieldsSchema
				});

				const start = Date.now();
				const result = await generateObject({
					model: selectedModel.model,
					schema: singleItemSchema,
					temperature: 1,
					providerOptions: {
						openai: {
							reasoningEffort: "low",
						},
						google: {
                            thinkingConfig: {
                                thinkingBudget: 0,
                            },
                        },
					},
					system: `You are an AI assistant that answers questions about the provided content.
							You will answer questions according to the specified screening fields.
							Return values in the appropriate type (string, number, or boolean) as specified in each field's type.`,
					prompt: `Answer questions about the following item based on these screening fields:
							${JSON.stringify(smartScreeningFields)}
							
							Item to analyze:
							${JSON.stringify(item)}
							
							Provide answers for all the screening fields. You must answer every question.
							If a question is not applicable to this item, respond with "N/A". Return values in the appropriate type as specified.`
				});
				const end = Date.now();

				// Map the random keys back to the original field names
				const newObject: Record<string, any> = {};
				for (const fieldKey of Object.keys(result.object.screeningFields)) {
					const mappedKey = fieldMaps.get(fieldKey);
					if (mappedKey) {
						newObject[mappedKey] = result.object.screeningFields[fieldKey];
					}
				}

				// Return the result for this item
				return {
					key: item.key,
					result: { screeningFields: newObject }
				};
			} catch (error) {
				return { key: item.key, error };
			}
		});

		// Wait for all items in the current chunk to complete
		const chunkResults = await Promise.all(chunkPromises);

		// Add results to the result object
		for (const result of chunkResults) {
			if (result.key && result.result) {
				resultObject[result.key] = result.result;
			}
		}
	}

	return resultObject;
}

export async function authorize(
	props: CredentialsInput,
): Promise<{ error: string } | { success: true }> {
	const result = await authorizeForConfig(
		props,
		await getLibraryConfig(),
	);
	return "error" in result ? result : { success: true };
}

export async function getItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	userId: string | null = null
) {
	const collections = searchParams.collections || [];
	const libraryConfig = await getLibraryConfig();

	const userFilters = await getProfileSearchFilter(
		userId,
		searchParams.collectionId || ""
	);

	const facets = getRuntimeSearchFacets(
		libraryConfig.search,
		libraryConfig.filters,
	);

	return searchIndex(
		searchParams,
		{
			facets,
		},
		[
			...collections.map((collection: string) =>
				meilisearchEquals("collectionsAncestry", collection),
			),
			...(userFilters?.filter ? userFilters.filter : []),
		]
	);
}

export async function getProfileSearchFilter(
	id: string | null,
	collectionId: string | null
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
				meilisearchIn("key", likes
					.filter(
						(like: InferSelectModel<typeof usersToLikes>) =>
							!like.deleted
					)
					.map(
						(like: InferSelectModel<typeof usersToLikes>) =>
							like.itemKey,
					)),
			],
		};
	}

	return { filter: null };
}

export async function convertItem(
	item: Item | Item[],
	format: "ris" | "bibtex" | "citation"
) {
	const itemsList = Array.isArray(item) ? item : [item];
	const texts: string[] = [];

	const promises = itemsList.map(async (item) => {
		try {
			const BibTeX = new BibTeXExporter(item);

			if (format === "ris") {
				const ret = await BibTeX.toRIS();
				texts.push(ret);
			}

			if (format === "bibtex") {
				const ret = await BibTeX.toBibTeX();
				texts.push(ret);
			}

			if (format === "citation") {
				const ret = await BibTeX.toCitation();
				texts.push(ret);
			}
		} catch (error) {
		}
	});

	await Promise.allSettled(promises);

	return texts.join("\n\n");
}

export async function getLikedPosts(likes: Session["user"]["likes"]) {
	const libraryConfig = await getLibraryConfig();
	const { index } = await getMeilisearchForConfig(libraryConfig);
	const res = await index.getDocuments({
		filter: meilisearchIn("key", Object.keys(likes)),
		});

	return res.results;
}
export async function searchIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraProperties: Parameters<
		Awaited<ReturnType<typeof getMeilisearchForConfig>>["index"]["search"]
	>[1] = {},
	extraFilters: NonNullable<
		Parameters<
			Awaited<ReturnType<typeof getMeilisearchForConfig>>["index"]["search"]
		>[1]
	>["filter"] = []
) {
	const items = async () => {
		const libraryConfig = await getLibraryConfig();
		const {
			attributesToSearchOn,
			author_country,
			country,
			finalFilters: baseFilters,
			limitNum,
			pageNum,
			search,
			sortOption,
		} = resolveSearchRequest(searchParams, libraryConfig);
		const { index: searchIndex } =
			await getMeilisearchForConfig(libraryConfig);
		const finalFilters = [
			...baseFilters,
			...(Array.isArray(extraFilters) ? extraFilters : []),
		];

		const allAttributes = await getMainAttributes(libraryConfig);

		const [searchResults, collections] = await Promise.all([
			searchIndex.search(search, {
				offset: (pageNum - 1) * limitNum,
				limit: limitNum,
				attributesToSearchOn,
				attributesToRetrieve: allAttributes,
				...(sortOption ? { sort: [sortOption] } : {}),
				...extraProperties,
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
							(c: Collection) => c.key === collection
						);
						return collectionData;
					})
					.filter(
						(collectionData: Collection | undefined) =>
							collectionData !== undefined
					) as Collection[];
			}

			item.attachmentsData = item.attachmentsData?.filter((attachment: any) => attachment.deleted === 0);

			// await setCachedItemSmall(item.key, {
			// 	item: item as Item,
			// });

			return item;
		});

		await Promise.all(itemPromises);

		// Pass country selections to addRegionsToFacetDistribution
		return {
			items: items as Item[],
			currentPage: pageNum,
			totalItems: totalCount,
			perPage: limitNum,
			totalPages: Math.ceil(totalCount / limitNum),
			facetDistribution: addRegionsToFacetDistribution(
				Object.assign(
					{},
					searchResults.facetDistribution,
					countryFacetOptions
						.filter(
							(facet) =>
								Array.isArray(extraProperties.facets) &&
								extraProperties.facets.includes(facet.key),
						)
						.reduce((acc, facet) => {
							acc[facet.key + "_uncategorized"] =
								searchResults.facetDistribution?.[
									facet.key
								] || {};
							return acc;
						}, {} as FacetDistribution)
				),
				{
					country: country,
					author_country: author_country
				}
			),
		};
	};

	return items();
}
