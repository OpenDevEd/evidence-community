import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "./types";
import { defaultParams } from "@/lib/utils";
import { getPublicItems } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { routing } from "@/i18n/routing";

export async function GET(request: NextRequest) {
	const url = new URL(request.url);
	const queryParams = defaultParams(url.searchParams);
	const includeHeavyFields = url.searchParams.get("includeHeavyFields") === "true";
	// shortcut: mock — the page's language comes from the page that asked (theme names are written in it).
	const pageLocale = new URL(request.headers.get("referer") ?? url.href).pathname.split("/")[1];
	const res = await getPublicItems(queryParams, {
		includeHeavyFields,
		locale: routing.locales.includes(pageLocale as never) ? pageLocale : routing.defaultLocale,
	});
	return NextResponse.json<ItemsGetResponse>(res, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
