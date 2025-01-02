"use server";

import { db } from "@/db";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and } from "drizzle-orm";
import { Session } from "next-auth";
import { signIn } from "next-auth/react";
import Error from "next/error";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { userToFollow } from "@/db/schema/tables/userToFollow";
import { userCollection } from "@/db/schema/tables/userCollection";


export async function getLikedPosts(likes: Session["user"]["likes"]) {
	const res = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getDocuments({
		filter: `key IN [${Object.keys(likes).map(key => `"${key}"`).join(",")}]`,
	});

	return res.results;
}

export async function getProfile(id: string, session: Session | null): Promise<Session["user"]> {
	const data = await db.transaction(async (tx) => {
		const following = await tx.query.userToFollow.findMany({
			where: and(
				eq(userToFollow.userId, id),
				eq(userToFollow.deleted, false)
			)
		}).then(following => following.reduce((acc, follow) => {
			acc[follow.followingId] = follow.createdAt;
			return acc;
		}, {} as Session["user"]["following"]));

		const followers = await tx.query.userToFollow.findMany({
			where: and(
				eq(userToFollow.followingId, id),
				eq(userToFollow.deleted, false)
			)
		}).then(followers => followers.reduce((acc, follower) => {
			acc[follower.userId] = follower.createdAt;
			return acc;
		}, {} as Session["user"]["followers"]));

		const collections = await tx.query.userCollection.findMany({
			where: eq(userCollection.userId, id),
		});

		const likes = await tx.query.usersToLikes.findMany({
			where: eq(usersToLikes.userId, id),
			columns: {
				itemKey: true,
				createdAt: true,
			},
		}).then(likes => likes.reduce((acc, like) => {
			acc[like.itemKey] = like.createdAt;
			return acc;
		}, {} as Session["user"]["likes"]));

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
			}
		});

		return {
			...profile,
			id,
			...data,
		}
	}

	session.user = {
		...session.user,
		id,
		...data,
	}

	return session.user;
}