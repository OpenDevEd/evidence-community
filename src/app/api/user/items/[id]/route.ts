import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "@/app/api/items/types";
import { getProfileSearchFilter, searchIndex } from "@/lib/actions";
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

	const { filter, status } = await getProfileSearchFilter(id, collectionId);
	
	if (status) {
		return NextResponse.json<ItemsGetResponse>(
			EMPTY_ITEMS_RESPONSE,
			{ status }
		);
	}

	const res = filter 
		? await searchIndex(request.url, {}, filter)
		: EMPTY_ITEMS_RESPONSE;

	return NextResponse.json<ItemsGetResponse>(res);
}

