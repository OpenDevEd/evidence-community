import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "@/app/api/items/types";
import { searchIndex } from "@/lib/actions";
import { getCachedUserCollectionKeys, getCachedUserLikes } from "../../../cache";
import { authOptions, auth } from "../../../auth/[...nextauth]/config";
import { z } from "zod";

const EMPTY_ITEMS_RESPONSE = {
	items: [],
	currentPage: 1,
	totalItems: 0,
	perPage: 10,
	totalPages: 1,
};

const getItemsSchema = z.object({
	collectionId: z.string().optional(),
	userId: z.string().optional(),
});

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const { searchParams } = new URL(request.url);
    const collectionId = searchParams.get("collectionId") || "";
    const { id } = params;

    if (!collectionId && !id) {
		return NextResponse.json<ItemsGetResponse>(EMPTY_ITEMS_RESPONSE);
	}

    const [session, collectionKeys, likes] = await Promise.all([
		auth(),
		collectionId ? getCachedUserCollectionKeys(collectionId) : null,
		id && !collectionId ? getCachedUserLikes(id) : null,
	]);

    let res: ItemsGetResponse = EMPTY_ITEMS_RESPONSE;

    if (collectionKeys) {
		if (!collectionKeys) {
			return NextResponse.json<ItemsGetResponse>(res);
		}

		if (collectionKeys.private) {
			const userId = session?.user?.id;

			if (!id) {
				return NextResponse.json<ItemsGetResponse>(
					res,
					{ status: 401 }
				);
			}

			if (collectionKeys.userId !== userId) {
				return NextResponse.json<ItemsGetResponse>(
					res,
					{ status: 403 }
				);
			}
		}

		res = await searchIndex(request, {
			filter: [
				`key IN [${collectionKeys.itemKeys
					.map((key) => `"${key}"`)
					.join(",")}]`,
			],
		});
	} else if (likes) {
		res = await searchIndex(request, {
			filter: [
				`key IN [${likes.filter((like) => !like.deleted).map((like) => `"${like.itemKey}"`).join(",")}]`,
			],
		});
	}

    return NextResponse.json<ItemsGetResponse>(res);
}

