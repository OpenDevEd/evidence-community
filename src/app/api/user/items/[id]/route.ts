import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "@/app/api/items/types";
import { getItems } from "@/lib/actions";
import { defaultParams } from "@/lib/utils";
import {
	featureUnavailableResponse,
	getConfigForEnabledFeature,
} from "@/lib/runtime-feature";

/** A reader's bookmarks, or one of their collections, as the library lists records. */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
	const config = await getConfigForEnabledFeature("readerAccounts");
	if (!config) return featureUnavailableResponse();

	const { id } = await props.params;
	const res = await getItems(defaultParams(new URL(request.url).searchParams), id);
	if ("refused" in res) {
		return NextResponse.json(
			{ error: res.refused === 404 ? "There is no such collection." : "This collection is private." },
			{ status: res.refused },
		);
	}

	return NextResponse.json<ItemsGetResponse>(res);
}
