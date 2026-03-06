"use server";

import { db } from "@/db";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and, InferSelectModel } from "drizzle-orm";
import { userToFollow } from "@/db/schema/tables/userToFollow";
import { userCollection } from "@/db/schema/tables/userCollection";
import {
	EXCLUDED_ITEM_TYPES,
	ITEMS_PER_PAGE,
	SCOPE_OPTIONS,
	SORT_OPTIONS,
} from "@/constants/items";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { BibTeXExporter } from "@/lib/formatAsBibTeX";
import { buildItemsQuery, defaultParams, ensureNoBlankItems, generateRandomID, ItemToZoteroJSON, parseCompanyName, processSentenceCaseAPAItems, validateContactRequest, validateTakedownRequest } from "@/lib/utils";
import {
	getCachedCollections,
	getCachedItemSmall,
	getCachedStatus,
	getUserCollectionKeysDirect,
	getUserLikesDirect,
} from "@/app/api/cache";
import { getAuthenticatedDbUser } from "@/auth/server";
import { unstable_cache } from "next/cache";
import { Collection } from "@/app/api/collections/types";
import { z } from "zod";
import { inferParserType } from "nuqs";
import { searchParamsLoader } from "./searchParams";
import { formatRange } from "@/lib/utils";
import { SmartScreeningField } from "@/components/pages/EvidenceLibrary";
import { generateObject } from "ai";
import { getModel } from "./ai";
import { headers } from "next/headers";
import { COUNTRY_HIERARCHY, countryFacetOptions, Entry } from "@/constants/misc";
import { FacetDistribution } from "meilisearch";
import { blockedTags } from "@/constants/misc";
import transporter from "./nodemailer";
import { Engine, CiteProcSys, CSLItem, CitationCluster } from 'citeproc'
import { addRegionsToFacetDistribution, createCountryFilters } from "./country";
import type { AppSession, AppSessionUser } from "@/auth/types";

export async function getStyle() {
	const cached = unstable_cache(async () => {
		const url = new URL("https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl");
		const res = await fetch(url.toString());
		const data = await res.text();
		return data;
	}, ["apa.csl"], {
		revalidate: 60 * 60 * 24,
	})

	return cached();
}

async function getLocaleXML(lang: string = "en-GB"): Promise<string> {
	const cached = unstable_cache(async () => {
		const url = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${lang}.xml`;
		const res = await fetch(url);
		if (!res.ok) throw new Error("Failed to fetch locale");
		return res.text();
	}, ["locale", lang], {
		revalidate: 60 * 60 * 24,
	})

	return cached();
}

export async function getCitationFromCSL(csl: any, lang: string = "en-GB") {
	const [style, locale] = await Promise.all([
		getStyle(),
		getLocaleXML(lang)
	]);

	// Set up an items map for this run
	const items: Record<string, CSLItem> = { [csl.id]: csl };

	// We have to provide a sys object with access to our locale and item
	const sys: CiteProcSys = {
		retrieveLocale: (_lang: string) => {
			// Ignore lang argument for this single-locale case
			return locale;
		},
		retrieveItem: (id: string) => {
			return items[id];
		},
	};

	const citeproc = new Engine(sys, style, lang);

	// Generate the bibliography (full reference format)
	// First, we need to register the item with the processor
	citeproc.updateItems([csl.id]);
	
	// Generate bibliography
	const [, bibliography] = citeproc.makeBibliography();
	const citation = bibliography && bibliography.length > 0 ? bibliography[0] : '';


	return citation;
}

export async function getCSL(item: Item) {
	const cached = unstable_cache(async () => {
		const zoteroItem = ItemToZoteroJSON(item);
		try {
			const url = new URL(process.env.ZOTERO_TRANSLATION_SERVER_URL!);
			url.pathname = "export";
			url.searchParams.set("format", "csljson");
			const res = await fetch(url.toString(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify([zoteroItem]),
			});
			const data = await res.json();
			const cslData = data ? ensureNoBlankItems(data[0]) : null;	
			return cslData;
		} catch (error) {
			console.error(error);
			return null;
		}
	}, ["csl", item.id], {
		revalidate: 60,
	})

	return cached();
}


export async function getRateLimits() {
	const headersList = await headers();
	const retryAt = headersList.get("X-RateLimit-Reset");
	const remaining = headersList.get("X-RateLimit-Remaining");
	const limit = headersList.get("X-RateLimit-Limit");
	const retryAfter = headersList.get("Retry-After");

	return {
		retryAt: retryAt ? parseInt(retryAt) : null,
		remaining: remaining ? parseInt(remaining) : null,
		limit: limit ? parseInt(limit) : null,
		retryAfter: retryAfter ? parseInt(retryAfter) : null,
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

export async function sendTakedownRequest(email: string, links: string[], description: string) {
	if (!transporter) {
		return { error: "Transporter not found" };
	}

	const status = await getCachedStatus();

	const { companyName, siteName } = parseCompanyName(status.companyName);
	const validator = await validateTakedownRequest(email, links, description);
	if ("error" in validator) {
		return { error: validator.error };
	}

	const mailOptions = {
		from: email,
		to: process.env.TAKEDOWN_EMAIL,
		subject: `${companyName} - ${siteName} - Takedown Request`,
		text: `Email: ${email}\nLinks: ${links.join("\n")}\nDescription: ${description}`,
	};

	const result = await transporter.sendMail(mailOptions);

	return { success: result.accepted.length > 0 };
}

export async function sendContactRequest(email: string, description: string) {
	if (!transporter) {
		return { error: "Transporter not found" };
	}


	const status = await getCachedStatus();
	const { companyName, siteName } = parseCompanyName(status.companyName);
	const validator = await validateContactRequest(email, description);

	if ("error" in validator) {
		return { error: validator.error };
	}

	const mailOptions = {
		from: email,
		to: process.env.CONTACT_EMAIL,
		subject: `${companyName} - ${siteName} - Feedback`,
		text: `Email: ${email}\nDescription: ${description}`,
	};

	const result = await transporter.sendMail(mailOptions);

	return { success: result.accepted.length > 0 };
}
export async function runScreening(
	keys: string[],
	modelIndex: number,
	smartScreeningFields: SmartScreeningField[]
) {
	const { provider, modelName, error } = getModel(modelIndex);
	if (error) {
		return { error: error };
	}

	if (!provider || !modelName) {
		return { error: "Model not found" };
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
					model: provider!(modelName!) as any,
					schema: singleItemSchema,
					temperature: 1,
					providerOptions: {
						openai: {
							reasoningEffort: "minimal",
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

export async function getItems(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	userId: string | null = null
) {
	const collections = searchParams.collections || [];

	const userFilters = await getProfileSearchFilter(
		userId,
		searchParams.collectionId || ""
	);

	const facets = ["collectionsAncestry", "institution"];
	if (process.env.NEXT_PUBLIC_DISABLE_COUNTRY !== "true") {
		facets.push("country");
	}
	if (process.env.NEXT_PUBLIC_DISABLE_AUTHOR_COUNTRY !== "true") {
		facets.push("creators.institutions.country_code");
	}

	if (userFilters?.status && userFilters.status >= 400) {
		return {
			items: [],
			currentPage: 1,
			totalItems: 0,
			perPage: ITEMS_PER_PAGE,
			totalPages: 1,
			facetDistribution: {},
		};
	}

	return searchIndex(
		searchParams,
		{
			facets,
		},
		[
			...collections.map(
				(collection: string) => `collectionsAncestry = "${collection}"`
			),
			...(userFilters?.filter ? userFilters.filter : []),
		]
	);
}

const EMPTY_PROFILE_FILTER = `key = "__profile_no_matches__"`;

function createKeyFilter(keys: string[]) {
	const uniqueKeys = Array.from(
		new Set(keys.filter((key) => key.trim().length > 0))
	);

	if (uniqueKeys.length === 0) {
		return [EMPTY_PROFILE_FILTER];
	}

	return [
		`key IN [${uniqueKeys
			.map((key) => `"${key.replace(/"/g, '\\"')}"`)
			.join(",")}]`,
	];
}

export async function getProfileSearchFilter(
	id: string | null,
	collectionId: string | null
) {

	if (!collectionId && !id) {
		return { filter: null };
	}

	const [authenticatedUser, collectionKeys, likes] = (await Promise.all([
		getAuthenticatedDbUser(),
		collectionId ? getUserCollectionKeysDirect(collectionId) : null,
		id && !collectionId ? getUserLikesDirect(id) : null,
	])) as [Awaited<ReturnType<typeof getAuthenticatedDbUser>>, any, any];

	if (collectionId) {
		if (!collectionKeys) {
			return { filter: createKeyFilter([]), status: 404 };
		}

		if (collectionKeys.private) {
			const userId = authenticatedUser?.id;

			if (!id) {
				return { filter: createKeyFilter([]), status: 401 };
			}

			if (collectionKeys.userId !== userId) {
				return { filter: createKeyFilter([]), status: 403 };
			}
		}

		return {
			filter: createKeyFilter(collectionKeys.itemKeys),
		};
	}

	if (likes) {
		const likeKeys = likes
			.filter(
				(like: InferSelectModel<typeof usersToLikes>) =>
					!like.deleted
			)
			.map(
				(like: InferSelectModel<typeof usersToLikes>) =>
					like.itemKey
			);

		return {
			filter: createKeyFilter(likeKeys),
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

export async function downloadItems(
	queryParams: Record<string, any>,
	params: Record<string, any>,
	format: "ris" | "bibtex"
) {
	const searchParams = defaultParams(queryParams);
	const { collections, collectionId } = searchParams;
	const id = params.id;
	const { filter, status } = await getProfileSearchFilter(id, collectionId);

	const items = await searchIndex(
		searchParams,
		{
			limit: 1000000,
		},
		[
			...collections.map(
				(collection: string) => `collectionsAncestry = "${collection}"`
			),
			...(filter ? filter : []),
		]
	);

	return await convertItem(items.items, format);
}

export async function getLikedPosts(likes: AppSessionUser["likes"]) {
	const res = await meilisearchClient
		.index(process.env.MEILI_INDEX || config.index)
		.getDocuments({
			filter: `key IN [${Object.keys(likes)
				.map((key) => `"${key}"`)
				.join(",")}]`,
		});

	return res.results;
}

export async function getMainAttributes() {
	const getCachedResults = unstable_cache(
		async () => {
			const attributes = await meilisearchClient
				.index(process.env.MEILI_INDEX || config.index)
				.getDisplayedAttributes();

			return attributes;
		},
		[],
		{ tags: ["attributes"], revalidate: 60 }
	);

	const attributes = await getCachedResults();

	return attributes.filter(
		(attribute) => !attribute.endsWith("fullTextPDFs")
	);
}

function cleanTheAttributesToSearchOn(fields: string[]) {
	if (process.env.NEXT_PUBLIC_DISABLE_FULLTEXT === "true") {
		fields = fields.filter(field => !field.includes("fullTextPDF"));
	}

	if (process.env.NEXT_PUBLIC_DISABLE_TAGS === "true") {
		fields = fields.filter(field => !field.includes("tags"));
	}

	return fields;
}

function isEmptyValue(value: any): boolean {
	return value === null ||
		value === undefined ||
		value === "" ||
		(Array.isArray(value) && value.length === 0);
}

function filterEmptyValues<T extends Record<string, any>>(obj: T): Record<string, any> {
	return Object.entries(obj).reduce((acc, [key, value]) => {
		if (!isEmptyValue(value)) {
			acc[key] = value;
		}
		return acc;
	}, {} as Record<string, any>);
}

function serializeWithoutQuotes(obj: any): string {
	if (Array.isArray(obj)) {
		return `[${obj.map(serializeWithoutQuotes).join(',')}]`;
	}
	if (typeof obj === 'object' && obj !== null) {
		const entries = Object.entries(obj)
			.map(([key, value]) => `${key}:${serializeWithoutQuotes(value)}`)
			.join(',');
		return `{${entries}}`;
	}
	if (typeof obj === 'string') {
		return obj;
	}
	return String(obj);
}

function cleanCacheKey(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraFilters: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"] = [],
	extraProperties: Parameters<
		ReturnType<typeof meilisearchClient.index>["search"]
	>[1] = {}
) {
	// Remove default values that don't affect search results
	const cleanedSearchParams = filterEmptyValues({
		...searchParams,
		// Remove defaults
		page: searchParams.page !== 1 ? searchParams.page : undefined,
		sort: searchParams.sort !== SORT_OPTIONS[0].key ? searchParams.sort : undefined,
		scope: searchParams.scope !== SCOPE_OPTIONS[0].key ? searchParams.scope : undefined,
	});

	// Remove redundant collection filters since they're already in searchParams.collections
	const cleanedExtraFilters = Array.isArray(extraFilters)
		? extraFilters.filter(filter =>
			filter && !filter.includes('collectionsAncestry = ')
		)
		: [];

	// Remove standard facets that are always the same
	const standardFacets = ["collectionsAncestry", "institution", "country", "creators.institutions.country_code"];
	const cleanedExtraProperties = filterEmptyValues({
		...extraProperties,
		facets: Array.isArray(extraProperties.facets) &&
			JSON.stringify(extraProperties.facets) !== JSON.stringify(standardFacets)
			? extraProperties.facets
			: undefined,
	});

	const keyParts = [
		cleanedSearchParams,
		cleanedExtraFilters,
		cleanedExtraProperties
	]
		.filter(part => Array.isArray(part) ? part.length > 0 : Object.keys(part).length > 0)
		.map(part => serializeWithoutQuotes(part));

	return keyParts.join('-') || 'default';
}

export async function searchIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraProperties: Parameters<
		ReturnType<typeof meilisearchClient.index>["search"]
	>[1] = {},
	extraFilters: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"] = []
) {
	const items = async () => {
		const pageNum = Math.max(1, Number(searchParams.page || 1));
		const limitNum = ITEMS_PER_PAGE;
		const sort = searchParams.sort || SORT_OPTIONS[0].key;
		const search = searchParams.search || "";
		const scope = searchParams.scope || SCOPE_OPTIONS[0].key;
		const range = searchParams.range || null;
		const institution = searchParams.institution || [];
		const country = searchParams.country || [];
		const author_country = searchParams.author_country || [];
		const author = searchParams.author || "";
		const searchIndex = meilisearchClient.index(
			process.env.MEILI_INDEX || config.index
		);
		// If no search query and relevance is selected, default to desc (newest)
		// Otherwise, use the selected sort
		const effectiveSort = search.trim().length === 0 && sort === SORT_OPTIONS[0].key
			? SORT_OPTIONS[1].key
			: sort;
		const sortOption =
			SORT_OPTIONS.find((option) => option.key === effectiveSort)?.sort ||
			SORT_OPTIONS[0].sort;

		// Generate hierarchical country filters
		const countryFilters = createCountryFilters(country, author_country);

		const finalFilters = [
			`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
			range ? formatRange(range) : null,
			...(Array.isArray(institution) ? institution.map((i) => `institution = "${i}"`) : []),
			...countryFilters, // Replace the old country filters with our hierarchical ones
			author ? `fullNames = "${author}"` : null,
			scope === "documents" ? `fullTextPDFs.fullTextPDF.text EXISTS` : null,
			...(Array.isArray(extraFilters) ? extraFilters : []),
			"deleted != 1",
			`tags NOT IN ${JSON.stringify(blockedTags)}`
		].filter((f): f is string => f !== null);

		const allAttributes = await getMainAttributes();

		const [searchResults, collections] = await Promise.all([
			searchIndex.search(search, {
				offset: (pageNum - 1) * limitNum,
				limit: limitNum,
				attributesToSearchOn: cleanTheAttributesToSearchOn(
					SCOPE_OPTIONS.find((option) => option.key === scope)
						?.attributesToSearchOn ||
					SCOPE_OPTIONS[0].attributesToSearchOn,
				),
				attributesToRetrieve: allAttributes,
				...(sortOption ? { sort: [sortOption] } : {}),
				...extraProperties,
				filter: finalFilters,
			}),
			getCachedCollections(),
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
			totalPages: Math.max(1, Math.ceil(totalCount / limitNum)),
			facetDistribution: addRegionsToFacetDistribution(
				Object.assign(
					{},
					searchResults.facetDistribution,
					countryFacetOptions.reduce((acc, facet) => {
						acc[facet.key + "_uncategorized"] = searchResults.facetDistribution?.[facet.key] || {};
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

export async function getProfile(
	id: string,
	session: AppSession | null
): Promise<AppSessionUser | null> {
	const isCurrentUser = session?.user.id === id;

	const getErrorCode = (error: unknown): string | null => {
		if (error && typeof error === "object" && "code" in error) {
			const code = (error as { code?: unknown }).code;
			return typeof code === "string" ? code : null;
		}
		return null;
	};

	const getErrorMessages = (error: unknown): string[] => {
		const messages: string[] = [];

		if (error instanceof Error) {
			messages.push(error.message);
			if ("cause" in error && error.cause) {
				messages.push(...getErrorMessages(error.cause));
			}
		} else if (typeof error === "string") {
			messages.push(error);
		}

		return messages;
	};

	const isTransientDbError = (error: unknown): boolean => {
		const code = getErrorCode(error);
		if (code && ["ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01", "57P02", "57P03", "53300"].includes(code)) {
			return true;
		}

		const combinedMessage = getErrorMessages(error).join(" ").toLowerCase();
		return [
			"connection terminated unexpectedly",
			"connection reset",
			"connection closed",
			"terminating connection",
			"server closed the connection unexpectedly",
			"too many clients already",
		].some((snippet) => combinedMessage.includes(snippet));
	};

	const withTransientDbRetry = async <T>(
		operation: () => Promise<T>,
		maxRetries: number = 2
	): Promise<T> => {
		let attempt = 0;
		for (;;) {
			try {
				return await operation();
			} catch (error) {
				if (!isTransientDbError(error) || attempt >= maxRetries) {
					throw error;
				}
				const backoffMs = 100 * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
				attempt++;
			}
		}
	};

	const data = await withTransientDbRetry(async () => {
		const [
			followingRows,
			followersRows,
			collections,
			likesRows,
			profile,
			itemCollectionRows,
		] = await Promise.all([
			db.query.userToFollow.findMany({
				where: and(eq(userToFollow.userId, id), eq(userToFollow.deleted, false)),
			}),
			db.query.userToFollow.findMany({
				where: and(eq(userToFollow.followingId, id), eq(userToFollow.deleted, false)),
			}),
			db.query.userCollection.findMany({
				where: and(eq(userCollection.userId, id), eq(userCollection.deleted, false)),
			}),
			db.query.usersToLikes.findMany({
				where: and(eq(usersToLikes.userId, id), eq(usersToLikes.deleted, false)),
				columns: {
					itemKey: true,
					createdAt: true,
				},
			}),
			isCurrentUser
				? Promise.resolve(session?.user ?? null)
				: db.query.users.findFirst({
					where: eq(users.id, id),
					columns: {
						name: true,
						image: true,
						email: true,
						createdAt: true,
					},
				}),
			db.query.itemToUserCollection.findMany({
				where: and(eq(itemToUserCollection.userId, id), eq(itemToUserCollection.deleted, false)),
			}),
		]);

		const following = followingRows.reduce((acc, follow) => {
			acc[follow.followingId] = follow.createdAt;
			return acc;
		}, {} as AppSessionUser["following"]);

		const followers = followersRows.reduce((acc, follower) => {
			acc[follower.userId] = follower.createdAt;
			return acc;
		}, {} as AppSessionUser["followers"]);

		const likes = likesRows.reduce((acc, like) => {
			acc[like.itemKey] = like.createdAt;
			return acc;
		}, {} as AppSessionUser["likes"]);

		const allowedCollectionIds = new Set(collections.map((collection) => collection.id));
		const itemsCollections = itemCollectionRows
			.filter((item) => allowedCollectionIds.has(item.userCollectionId))
			.reduce((acc, item) => {
				acc[item.itemKey] = acc[item.itemKey] || {};
				acc[item.itemKey][item.userCollectionId] = item.updatedAt;
				return acc;
			}, {} as AppSessionUser["itemsCollections"]);

		if (!isCurrentUser && !profile) {
			return null;
		}

		return {
			...(profile ?? {}),
			following,
			followers,
			likes,
			collections,
			id,
			itemsCollections,
		};
	});

	if (!data) {
		return null;
	}

	if (session) {
		session.user = {
			...session.user,
			...data,
		};
	}

	return session ? session.user : data;
}


export async function getTotalItems() {
	const stats = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getStats();
	return stats.numberOfDocuments;
}
