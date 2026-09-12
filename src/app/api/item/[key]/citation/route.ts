import { getCitationForItemKey } from "@/lib/citations";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { ZoteroTranslationError } from "@/lib/zotero-translation";
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
	let citation: string | null;

	try {
		citation = await getCitationForItemKey(params.key, locale);
	} catch (error) {
		if (!(error instanceof ZoteroTranslationError)) {
			console.error("Public citation read failed", { key: params.key, error });
			return NextResponse.json({ error: "Unable to load citation" }, {
				status: 503, headers: { "Cache-Control": "no-store" },
			});
		}

		console.warn("Zotero citation translation unavailable", error);
		return NextResponse.json<ItemCitationResponse>(
			{ citation: null },
			{
				headers: {
					"Cache-Control": "no-store",
					Vary: "Accept-Language",
				},
			},
		);
	}

	return NextResponse.json<ItemCitationResponse>(
		{ citation: citation || null },
		{
			headers: {
				"Cache-Control": "no-store",
				Vary: "Accept-Language",
			},
		},
	);
}
