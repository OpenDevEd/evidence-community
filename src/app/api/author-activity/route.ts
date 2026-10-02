import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { defaultParams } from "@/lib/utils";
import { AUTHOR_ACTIVITY_LIMIT, getAuthorActivity } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

const namesSchema = z.array(z.string().trim().min(1).max(300)).min(1).max(AUTHOR_ACTIVITY_LIMIT);

/** The top authors' results by year under the search and filters in the query: `name` once per author. */
export async function GET(request: NextRequest) {
	const url = new URL(request.url);
	const names = namesSchema.safeParse(url.searchParams.getAll("name"));
	if (!names.success) return NextResponse.json({ error: "Name between 1 and 10 authors" }, { status: 400 });
	url.searchParams.delete("name");
	const activity = await getAuthorActivity(defaultParams(url.searchParams), names.data);
	return NextResponse.json(activity, { headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } });
}
