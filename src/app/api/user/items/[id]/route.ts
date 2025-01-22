import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "@/app/api/items/types";
import { getItems, getProfileSearchFilter, searchIndex } from "@/lib/actions";
import { z } from "zod";
import { defaultParams } from "@/lib/utils";

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
	const { id } = params;

	const queryParams = defaultParams(searchParams);

	const res = await getItems(queryParams, id);

	return NextResponse.json<ItemsGetResponse>(res);
}

