import { and, eq } from "drizzle-orm";
import { userCollection } from "@/db/schema/tables/userCollection";
import { db } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedDbUser } from "@/auth/server";
import { fromError } from "zod-validation-error";
import { collectionFieldsSchema } from "../schema";

async function getAuthorizedCollection(id: string, userId: string) {
	const [collection] = await db
		.select()
		.from(userCollection)
		.where(
			and(
				eq(userCollection.id, id),
				eq(userCollection.deleted, false)
			)
		);

	if (!collection) {
		return {
			error: NextResponse.json(
				{ error: "Collection not found" },
				{ status: 404 }
			),
		};
	}

	if (collection.userId !== userId) {
		return {
			error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
		};
	}

	return { collection };
}

export async function PATCH(
	req: NextRequest,
	props: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await props.params;
		const user = await getAuthenticatedDbUser();
		if (!user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const access = await getAuthorizedCollection(id, user.id);
		if ("error" in access) {
			return access.error;
		}

		const body = await req.json();
		const validatedData = collectionFieldsSchema.safeParse(body);

		if (!validatedData.success) {
			return NextResponse.json(
				fromError(validatedData.error).toString(),
				{ status: 400 }
			);
		}

		const [updatedCollection] = await db
			.update(userCollection)
			.set({
				name: validatedData.data.name,
				description: validatedData.data.description,
				updatedAt: new Date(),
			})
			.where(eq(userCollection.id, access.collection.id))
			.returning();

		return NextResponse.json(updatedCollection);
	} catch (error) {
		console.error("Error updating collection:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}

export async function DELETE(
	_req: NextRequest,
	props: { params: Promise<{ id: string }> }
) {
	const { id } = await props.params;
	const user = await getAuthenticatedDbUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const access = await getAuthorizedCollection(id, user.id);
	if ("error" in access) {
		return access.error;
	}

	await db.update(userCollection).set({ deleted: true }).where(eq(userCollection.id, id));
	return NextResponse.json({ message: "Collection deleted" });
}
