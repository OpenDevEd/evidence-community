"use server";

import { db } from "@/db";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq } from "drizzle-orm";
import { Session } from "next-auth";
import { signIn } from "next-auth/react";
import Error from "next/error";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";

export async function getLikedPosts(likes: Session["user"]["likes"]) {
	const res = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getDocuments({
		filter: `key IN [${Object.keys(likes).map(key => `"${key}"`).join(",")}]`,
	});

	return res.results;
}

export async function getProfile(id: string, session: Session | null): Promise<Session["user"]> {
	const likes = await db.query.usersToLikes.findMany({
		where: eq(usersToLikes.userId, id),
		columns: {
			itemKey: true,
			createdAt: true,
		},
	});

	const likesObject = likes.reduce((acc, like) => {
		acc[like.itemKey] = like.createdAt;
		return acc;
	}, {} as Session["user"]["likes"]);

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
			likes: likesObject,
		}
	}

	session.user.likes = likesObject;
	session.user.id = id;

	return session.user;
}

export async function authenticate({
	email,
	password,
	register,
}: {
	email: string;
	password: string;
	register: boolean;
}): Promise<{ error: string } | any> {
	try {
		return await signIn("credentials", { email, password, register, redirect: false });
	} catch (error: any) {
		return { error: error.message };
	}
}
