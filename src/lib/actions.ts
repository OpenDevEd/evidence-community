"use server";

import { db } from "@/db";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and, InferSelectModel } from "drizzle-orm";
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
import { Item } from "@/app/api/item/types";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { BibTeXExporter } from "@/lib/formatAsBibTeX";
import { buildItemsQuery } from "@/lib/utils";
import {
	getCachedCollections,
	getCachedUserLikes,
	setCachedItemSmall,
} from "@/app/api/cache";
import { getCachedUserCollectionKeys } from "@/app/api/cache";
import { auth, credentialsSchema } from "@/app/api/auth/[...nextauth]/config";
import { revalidateTag, unstable_cache } from "next/cache";
import { Collection } from "@/app/api/collections/types";
import { z } from "zod";
import bcrypt from "bcrypt";

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
	searchParams: URLSearchParams | Record<string, any>,
	userId: string | null = null
) {
	const collections =
		searchParams instanceof URLSearchParams
			? searchParams.get("collections") || []
			: searchParams.collections || [];

	const userFilters = await getProfileSearchFilter(
		userId,
		searchParams instanceof URLSearchParams
			? searchParams.get("collectionId") || ""
			: searchParams.collectionId || ""
	);

	return searchIndex(
		searchParams instanceof URLSearchParams
			? searchParams
			: new URLSearchParams(searchParams),
		{
			facets: ["collectionsAncestry"],
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
	console.log("collectionId", collectionId);
	console.log("id", id);
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
	const url = buildItemsQuery(queryParams, "https://www.example.com");
	const { searchParams } = new URL(url);
	const collections = searchParams.get("collections")?.split(",") || [];
	const collectionId = searchParams.get("collectionId");
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

function formatRange(range: string | null) {
	if (!range) return null;

	const [start, end] = range.includes("-")
		? range.split("-")
		: [range, range];
	const startYear = Number(start);
	const endYear = Number(end);

	if (isNaN(startYear) && isNaN(endYear)) return null;
	if (startYear === endYear) return `year = ${startYear}`;

	return [
		startYear > 0 && `year >= ${startYear}`,
		endYear > 0 && `year <= ${endYear}`,
	]
		.filter(Boolean)
		.join(" AND ");
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
	searchParams: URLSearchParams,
	extraProperties: Parameters<
		ReturnType<typeof meilisearchClient.index>["search"]
	>[1] = {},
	extraFilters: NonNullable<
		Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]
	>["filter"] = []
) {
	const cacheKey = `${searchParams.toString()}-${extraFilters.toString()}`;

	const items = unstable_cache(async () => {
		const pageNum = Math.max(1, Number(searchParams.get("page")) || 1);
		const limitNum = Math.min(
			100,
			Math.max(1, Number(searchParams.get("limit")) || ITEMS_PER_PAGE)
		);
		const sort = searchParams.get("sort") || SORT_OPTIONS[0].key;
		const search = searchParams.get("search") || "";
		const scope = searchParams.get("scope") || SCOPE_OPTIONS[0].key;
		const range = searchParams.get("range") || null;
		const searchIndex = meilisearchClient.index(
			process.env.MEILI_INDEX || config.index
		);
		const sortOption =
			SORT_OPTIONS.find((option) => option.key === sort)?.sort ||
			SORT_OPTIONS[0].sort;

		const finalFilters = [
			`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
			range ? formatRange(range) : null,
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

			// if (item) {
			// 	item.citation = await convertItem(item as Item, "citation");
			// }

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
			where: eq(userCollection.userId, id),
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
				items.reduce((acc, item) => {
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
