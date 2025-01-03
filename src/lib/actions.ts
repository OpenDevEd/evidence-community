"use server";

import { db } from "@/db";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and } from "drizzle-orm";
import { Session } from "next-auth";
import { signIn } from "next-auth/react";
import Error from "next/error";
import { userToFollow } from "@/db/schema/tables/userToFollow";
import { userCollection } from "@/db/schema/tables/userCollection";
import { NextRequest, NextResponse } from "next/server";
import {
	EXCLUDED_ITEM_TYPES,
	ITEMS_PER_PAGE,
	SCOPE_OPTIONS,
	SORT_OPTIONS,
} from "@/constants/items";
import { ItemsGetResponse } from "@/app/api/items/types";
import { Item } from "@/app/api/item/types";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";

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

	const getTimestamp = (year: string) => {
		const num = Number(year);
		return num > 0 ? new Date(num, 0, 1).getTime() : null;
	};

	const [start, end] = range.includes("-")
		? range.split("-")
		: [range, range];
	const startTs = getTimestamp(start);
	const endTs = getTimestamp(end);

	if (!startTs && !endTs) return null;
	if (startTs === endTs) return `year = ${startTs}`;

	return [startTs && `year >= ${startTs}`, endTs && `year <= ${endTs}`]
		.filter(Boolean)
		.join(" AND ");
}

export async function searchIndex(
	request: NextRequest,
	extraProperties: Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1] = {},
	extraFilters: NonNullable<Parameters<ReturnType<typeof meilisearchClient.index>["search"]>[1]>["filter"] = []
) {
	const { searchParams } = new URL(request.url);
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

	const searchResults = await searchIndex.search(search, {
		offset: (pageNum - 1) * limitNum,
		limit: limitNum,
		attributesToSearchOn:
			SCOPE_OPTIONS.find((option) => option.key === scope)
				?.attributesToSearchOn || SCOPE_OPTIONS[0].attributesToSearchOn,
		filter: [
			`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
			range && formatRange(range),
			...(Array.isArray(extraFilters) ? extraFilters : []),
		].filter((f): f is string => f !== null),
		sort: [sortOption],
		...extraProperties,
	});

	const items = searchResults.hits;
	const totalCount = searchResults.estimatedTotalHits;

	return {
		items: items as Item[],
		currentPage: pageNum,
		totalItems: totalCount,
		perPage: limitNum,
		totalPages: Math.ceil(totalCount / limitNum),
		facetDistribution: searchResults.facetDistribution,
	};
}

export async function getProfile(
	id: string,
	session: Session | null
): Promise<Session["user"]> {
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
				where: eq(usersToLikes.userId, id),
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

		return {
			following,
			followers,
			likes,
			collections,
		};
	});

	if (!session) {
		const profile = await db.query.users.findFirst({
			where: eq(users.id, id),
			columns: {
				name: true,
				image: true,
				email: true,
				createdAt: true,
			},
		});

		return {
			...profile,
			id,
			...data,
		};
	}

	session.user = {
		...session.user,
		id,
		...data,
	};

	return session.user;
}
