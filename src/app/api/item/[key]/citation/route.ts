import { getCitationForItemKey } from "@/lib/citations";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { NextRequest, NextResponse } from "next/server";

export type ItemCitationResponse = {
	citation: string | null;
};

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {
	const params = await props.params;
	const locale = await getRuntimeRequestLocale(request);
	const citation = await getCitationForItemKey(params.key, locale);

	return NextResponse.json<ItemCitationResponse>(
		{
			citation: citation || null,
		},
		{
			headers: {
				"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
				Vary: "Accept-Language",
			},
		}
	);
}
