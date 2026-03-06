import { db } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { userCollection } from "@/db/schema/tables/userCollection";
import { updateCachedUserCollectionKeys } from "@/app/api/cache";
import { getAuthenticatedDbUser } from "@/auth/server";

const addToCollectionSchema = z.object({
	collectionId: z.string().uuid(),
});

export async function GET(_request: NextRequest, props: { params: Promise<{ key: string }> }) {
    const params = await props.params;
    const user = await getAuthenticatedDbUser();

    if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

    try {
		const { key } = params;

		const collections = await db.query.itemToUserCollection.findMany({
			where: and(
				eq(itemToUserCollection.itemKey, key),
				eq(itemToUserCollection.userId, user.id),
				eq(itemToUserCollection.deleted, false)
			),
			columns: {
				userCollectionId: true,
			},
		});

		return NextResponse.json({
			collections: collections.map((c) => c.userCollectionId),
		});
	} catch (error) {
		console.error("Error fetching user collections for item:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}

export async function POST(request: NextRequest, props: { params: Promise<{ key: string }> }) {
    const params = await props.params;
    const user = await getAuthenticatedDbUser();

    if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

    try {
		const { key } = params;
		const body = await request.json();

		const validatedData = addToCollectionSchema.safeParse(body);

		if (!validatedData.success) {
			return NextResponse.json(
				{ error: "Invalid collection ID" },
				{ status: 400 }
			);
		}

		const { collectionId } = validatedData.data;

		const [newState] = await db
			.insert(itemToUserCollection)
			.values({
				itemKey: key,
				userCollectionId: collectionId,
				userId: user.id,
				deleted: false,
			})
			.onConflictDoUpdate({
				target: [
					itemToUserCollection.itemKey,
					itemToUserCollection.userCollectionId,
					itemToUserCollection.userId,
				],
				set: {
					deleted: sql`NOT ${itemToUserCollection.deleted}`,
				},
			})
			.returning({ wasDeleted: itemToUserCollection.deleted });

		const increment = newState?.wasDeleted ? -1 : 1;

		await db.transaction(async (tx) => {
			await tx.update(userCollection)
				.set({
					numItems: sql`${userCollection.numItems} + ${increment}`,
				})
				.where(eq(userCollection.id, collectionId));

			await updateCachedUserCollectionKeys(collectionId);
		});

		return NextResponse.json(
			{ message: "Item collection status updated" },
			{ status: 200 }
		);
	} catch (error) {
		console.error("Error adding item to collection:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}
