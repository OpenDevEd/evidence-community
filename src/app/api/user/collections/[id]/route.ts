import { auth } from "@/app/api/auth/[...nextauth]/config";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { userCollection } from "@/db/schema/tables/userCollection";
import { getDatabaseForConfig } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import {
	featureUnavailableResponse,
	getConfigForEnabledFeature,
} from "@/lib/runtime-feature";

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
	const config = await getConfigForEnabledFeature("userCollections");
	if (!config) return featureUnavailableResponse();

	const { id } = await props.params;
	const session = await auth();
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const db = await getDatabaseForConfig(config);

	const collection = await db.select().from(userCollection).where(eq(userCollection.id, id));
	if (!collection) {
		return NextResponse.json({ error: "Collection not found" }, { status: 404 });
	}

	if (collection[0].userId !== session.user.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	await db.update(userCollection).set({ deleted: true }).where(eq(userCollection.id, id));

	revalidateTag('collections', "max");
	revalidateTag('userCollectionKeys-' + id, "max");

	return NextResponse.json({ message: "Collection deleted" });
}
