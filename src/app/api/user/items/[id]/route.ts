import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "@/app/api/items/types";
import { getItems } from "@/lib/actions";
import { z } from "zod";
import { defaultParams } from "@/lib/utils";
import {
	featureUnavailableResponse,
	getConfigForEnabledFeature,
} from "@/lib/runtime-feature";

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
	const config = await getConfigForEnabledFeature("login");
	if (!config) return featureUnavailableResponse();

	const params = await props.params;
	const { searchParams } = new URL(request.url);
	const { id } = params;

	const queryParams = defaultParams(searchParams);

	const res = await getItems(queryParams, id);
	if ("refused" in res) {
		return NextResponse.json(
			{ error: res.refused === 404 ? "There is no such collection." : "This collection is private." },
			{ status: res.refused },
		);
	}

	return NextResponse.json<ItemsGetResponse>(res);
}
