import "server-only";

import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import type { Session, User } from "next-auth";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getDatabaseForConfig, type Database } from "@/db";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { userCollection } from "@/db/schema/tables/userCollection";
import { users } from "@/db/schema/tables/user";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { userToFollow } from "@/db/schema/tables/userToFollow";

import {
	credentialsSchema,
	type CredentialsInput,
} from "./auth-credentials";

async function getUser(db: Database, email: string) {
	return db.query.users.findFirst({
		where: eq(users.email, email),
	});
}

async function createUser(
	db: Database,
	email: string,
	password: string,
) {
	const hashedPassword = await bcrypt.hash(password, 10);
	const [newUser] = await db
		.insert(users)
		.values({
			email,
			password: hashedPassword,
		})
		.returning();
	return newUser;
}

export async function authorizeForConfig(
	props: CredentialsInput,
	config: LibraryServerConfig,
): Promise<{ error: string } | User> {
	if (!isLibraryFeatureEnabled(config.features, "login")) {
		return { error: "loginDisabled" };
	}

	const parsedCredentials = credentialsSchema.safeParse(props);
	if (!parsedCredentials.success) {
		return {
			error: parsedCredentials.error.errors
				.map((error) => error.message)
				.join(", "),
		};
	}

	const { email, password, register } = parsedCredentials.data;
	const db = await getDatabaseForConfig(config);
	const existingUser = await getUser(db, email);

	if (register && existingUser) {
		return { error: "userAlreadyExists" };
	}

	if (!existingUser && register) {
		return createUser(db, email, password);
	}

	if (existingUser) {
		const passwordsMatch = await bcrypt.compare(
			password,
			existingUser.password ?? "",
		);
		if (passwordsMatch) return existingUser;
	}

	return { error: "invalidCredentials" };
}

export async function getProfileForConfig(
	id: string,
	session: Session | null,
	config: LibraryServerConfig,
): Promise<Session["user"]> {
	const isCurrentUser = session?.user.id === id;
	const db = await getDatabaseForConfig(config);

	const data = await db.transaction(async (tx) => {
		const following = await tx.query.userToFollow
			.findMany({
				where: and(
					eq(userToFollow.userId, id),
					eq(userToFollow.deleted, false),
				),
			})
			.then((records) =>
				records.reduce((accumulator, follow) => {
					accumulator[follow.followingId] = follow.createdAt;
					return accumulator;
				}, {} as Session["user"]["following"]),
			);

		const followers = await tx.query.userToFollow
			.findMany({
				where: and(
					eq(userToFollow.followingId, id),
					eq(userToFollow.deleted, false),
				),
			})
			.then((records) =>
				records.reduce((accumulator, follower) => {
					accumulator[follower.userId] = follower.createdAt;
					return accumulator;
				}, {} as Session["user"]["followers"]),
			);

		const collections = await tx.query.userCollection.findMany({
			where: and(
				eq(userCollection.userId, id),
				eq(userCollection.deleted, false),
			),
		});

		const likes = await tx.query.usersToLikes
			.findMany({
				where: and(
					eq(usersToLikes.userId, id),
					eq(usersToLikes.deleted, false),
				),
				columns: {
					itemKey: true,
					createdAt: true,
				},
			})
			.then((records) =>
				records.reduce((accumulator, like) => {
					accumulator[like.itemKey] = like.createdAt;
					return accumulator;
				}, {} as Session["user"]["likes"]),
			);

		const profile = isCurrentUser
			? session?.user
			: await tx.query.users.findFirst({
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
					eq(itemToUserCollection.deleted, false),
				),
			})
			.then((items) =>
				items
					.filter((item) =>
						collections.some(
							(collection) =>
								collection.id ===
								item.userCollectionId,
						),
					)
					.reduce((accumulator, item) => {
						accumulator[item.itemKey] =
							accumulator[item.itemKey] || {};
						accumulator[item.itemKey][
							item.userCollectionId
						] = item.updatedAt;
						return accumulator;
					}, {} as Session["user"]["itemsCollections"]),
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

	if (!session) return data;

	session.user = {
		...session.user,
		...data,
	};
	return session.user;
}
