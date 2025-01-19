import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "./types";
import { getItems } from "@/lib/actions";
import { defaultParams } from "@/lib/utils";

export async function GET(request: NextRequest) {
	const url = new URL(request.url);
	const queryParams = defaultParams(url.searchParams);
	const res = await getItems(queryParams);
	return NextResponse.json<ItemsGetResponse>(res);
}
