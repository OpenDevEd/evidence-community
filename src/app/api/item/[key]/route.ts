import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Item, ItemGetResponse } from "../types";
import { Collection } from "../../collections/types";
import { getCollections } from "../../collections/route";
import { revalidateTag } from "next/cache";

export async function GET(
	request: NextRequest,
	{ params }: { params: { key: string } }
) {
	const { key } = params;

	const [result, attachments, collections] = await db.transaction(
		async (tx) => {
			return await Promise.all([
				tx.query.item.findFirst({
					where: eq(item.key, key),
				}),
				tx.query.item.findMany({
					where: eq(item.parentItem, key),
				}),
				getCollections(),
			]);
		}
	);

	const response: ItemGetResponse = {
		item: result as Item,
	};

	response.item.attachmentsData = attachments || [];

	response.item.collectionsData = collections.filter((c) => result?.collections?.includes(c.key))

	return NextResponse.json(response);
}
