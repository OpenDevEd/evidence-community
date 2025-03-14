"use server";

import { db } from "@/db";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and, InferSelectModel, notInArray, count, ne } from "drizzle-orm";
import { Session, User } from "next-auth";
import { userToFollow } from "@/db/schema/tables/userToFollow";
import { userCollection } from "@/db/schema/tables/userCollection";
import { NextRequest } from "next/server";
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
import { buildItemsQuery, defaultParams, generateRandomID } from "@/lib/utils";
import {
	getCachedCollections,
	getCachedItemSmall,
	getCachedUserLikes,
	setCachedItemSmall,
} from "@/app/api/cache";
import { getCachedUserCollectionKeys } from "@/app/api/cache";
import { auth, credentialsSchema } from "@/app/api/auth/[...nextauth]/config";
import { revalidateTag, unstable_cache } from "next/cache";
import { Collection } from "@/app/api/collections/types";
import { z } from "zod";
import bcrypt from "bcrypt";
import { inferParserType } from "nuqs";
import { searchParamsLoader } from "./searchParams";
import { formatRange } from "@/lib/utils";
import { SmartScreeningField } from "@/components/pages/EvidenceLibrary";
import { generateObject } from "ai";
import { getModel } from "./ai";
import { google } from "@ai-sdk/google";
import { item } from "@/db/schema/tables/item";
import { headers } from "next/headers";

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

export async function runScreening(keys: string[], modelIndex: number, smartScreeningFields: SmartScreeningField[], distinctId: string) {
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

	// fs.writeFileSync("items.json", JSON.stringify(items, null, 2));
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
					model: provider!(modelName!),
					schema: singleItemSchema,
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

				console.log(`processed ${item.key} in ${end - start}ms`)
				
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
				console.error(`Error processing item ${item.key}:`, error);
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

export const getUser = async (email: string) => {
	return await db.query.users.findFirst({
		where: eq(users.email, email),
	});
};

export const createUser = async (email: string, password: string) => {
	const hashedPassword = await bcrypt.hash(password, 10);
	const [newUser] = await db
		.insert(users)
		.values({
			email,
			password: hashedPassword,
		})
		.returning();
	return newUser;
};


export async function authorize(props: z.infer<typeof credentialsSchema>): Promise<{ error: string } | User> {
	console.log("Authorizing credentials", props);

	const parsedCredentials = credentialsSchema.safeParse(props);

	console.log("Parsed credentials", parsedCredentials);

	if (!parsedCredentials.success) {
		const errorMessages = parsedCredentials.error.errors
			.map(err => err.message)
			.join(", ");
		return { error: errorMessages };
	}

	const { email, password, register } = parsedCredentials.data;

	const existingUser = await getUser(email);

	if (register && existingUser)
		return { error: "userAlreadyExists" };

	if (!existingUser && register)
		return await createUser(email, password);

	if (existingUser) {
		const passwordsMatch = await bcrypt.compare(
			password,
			existingUser.password ?? ""
		);
		if (passwordsMatch) return existingUser;
	}

	return { error: "invalidCredentials" };
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

export async function getProfileSearchFilter(
	id: string | null,
	collectionId: string | null
) {

	if (!collectionId && !id) {
		return { filter: null };
	}

	const [session, collectionKeys, likes] = (await Promise.all([
		auth(),
		collectionId ? getCachedUserCollectionKeys(collectionId, true) : null,
		id && !collectionId ? getCachedUserLikes(id, true) : null,
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
			filter: [
				`key IN [${collectionKeys.itemKeys
					.map((key: string) => `"${key}"`)
					.join(",")}]`,
			],
		};
	}

	if (likes) {
		return {
			filter: [
				`key IN [${likes
					.filter(
						(like: InferSelectModel<typeof usersToLikes>) =>
							!like.deleted
					)
					.map(
						(like: InferSelectModel<typeof usersToLikes>) =>
							`"${like.itemKey}"`
					)
					.join(",")}]`,
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
			console.log("Error converting item", item.key);
			console.log(error);
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

export async function getLikedPosts(likes: Session["user"]["likes"]) {
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

export async function searchIndex(
	searchParams: Partial<inferParserType<typeof searchParamsLoader>>,
	extraProperties: Parameters<
		ReturnType<typeof meilisearchClient.index>["search"]
	>[1] = {},
	extraFilters: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"] = []
) {
	const cacheKey = `${buildItemsQuery(searchParams)}-${JSON.stringify(extraFilters)}-${JSON.stringify(extraProperties)}`;

	const items = unstable_cache(async () => {
		const pageNum = Math.max(1, Number(searchParams.page || 1));
		const limitNum = ITEMS_PER_PAGE;
		const sort = searchParams.sort || SORT_OPTIONS[0].key;
		const search = searchParams.search || "";
		const scope = searchParams.scope || SCOPE_OPTIONS[0].key;
		const range = searchParams.range || null;
		const institution = searchParams.institution || "";
		const country = searchParams.country || [];
		const author = searchParams.author || "";
		const searchIndex = meilisearchClient.index(
			process.env.MEILI_INDEX || config.index
		);
		const sortOption =
			SORT_OPTIONS.find((option) => option.key === sort)?.sort ||
			SORT_OPTIONS[0].sort;


		const finalFilters = [
			`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
			range ? formatRange(range) : null,
			institution ? `institution = "${institution}"` : null,
			...(country.length > 0 ? country.map((c) => `country = "${c}"`) : []),
			author ? `fullNames = "${author}"` : null,
			scope === "documents" ? `fullTextPDFs.fullTextPDF.text EXISTS` : null,
			...(Array.isArray(extraFilters) ? extraFilters : []),
		].filter((f): f is string => f !== null);

		const allAttributes = await getMainAttributes();

		const [searchResults, collections] = await Promise.all([
			searchIndex.search(search, {
				offset: (pageNum - 1) * limitNum,
				limit: limitNum,
				attributesToSearchOn:
					SCOPE_OPTIONS.find((option) => option.key === scope)
						?.attributesToSearchOn ||
					SCOPE_OPTIONS[0].attributesToSearchOn,
				attributesToRetrieve: allAttributes,
				sort: [sortOption],
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

			await setCachedItemSmall(item.key, {
				item: item as Item,
			});

			return item;
		});

		await Promise.all(itemPromises);

		return {
			items: items as Item[],
			currentPage: pageNum,
			totalItems: totalCount,
			perPage: limitNum,
			totalPages: Math.ceil(totalCount / limitNum),
			facetDistribution: searchResults.facetDistribution,
		};
	}, [cacheKey], { tags: ["searchIndex"], revalidate: 60 });

	return items();
}

export async function getProfile(
	id: string,
	session: Session | null
): Promise<Session["user"]> {
	const isCurrentUser = session?.user.id === id;

	const data = await db.transaction(async (tx) => {
		const following = await tx.query.userToFollow
			.findMany({
				where: and(
					eq(userToFollow.userId, id),
					eq(userToFollow.deleted, false)
				),
			})
			.then((following) =>
				following.reduce((acc, follow) => {
					acc[follow.followingId] = follow.createdAt;
					return acc;
				}, {} as Session["user"]["following"])
			);

		const followers = await tx.query.userToFollow
			.findMany({
				where: and(
					eq(userToFollow.followingId, id),
					eq(userToFollow.deleted, false)
				),
			})
			.then((followers) =>
				followers.reduce((acc, follower) => {
					acc[follower.userId] = follower.createdAt;
					return acc;
				}, {} as Session["user"]["followers"])
			);

		const collections = await tx.query.userCollection.findMany({
			where: and(eq(userCollection.userId, id), eq(userCollection.deleted, false)),
		});

		const likes = await tx.query.usersToLikes
			.findMany({
				where: and(
					eq(usersToLikes.userId, id),
					eq(usersToLikes.deleted, false)
				),
				columns: {
					itemKey: true,
					createdAt: true,
				},
			})
			.then((likes) =>
				likes.reduce((acc, like) => {
					acc[like.itemKey] = like.createdAt;
					return acc;
				}, {} as Session["user"]["likes"])
			);

		const profile = isCurrentUser
			? session?.user
			: await db.query.users.findFirst({
				where: eq(users.id, id),
				columns: {
					name: true,
					image: true,
					email: true,
					createdAt: true,
				},
			});

		const itemsCollections = await tx.query.itemToUserCollection
			.findMany({
				where: and(
					eq(itemToUserCollection.userId, id),
					eq(itemToUserCollection.deleted, false)
				),
			})
			.then((items) =>
				items.filter((item) => collections.some((collection) => collection.id === item.userCollectionId)).reduce((acc, item) => {
					acc[item.itemKey] = acc[item.itemKey] || {};
					acc[item.itemKey][item.userCollectionId] = item.updatedAt;
					return acc;
				}, {} as Session["user"]["itemsCollections"])
			);

		return {
			...profile,
			following,
			followers,
			likes,
			collections,
			id,
			itemsCollections,
		};
	});

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