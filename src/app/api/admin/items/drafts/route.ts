import { getLibraryConfig } from "@/config/library-config/server";
import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { createNativeItemDraft } from "@/lib/admin/native-item-service";
import { adminCanonicalDraftToItemFields, isTopLevelAdminItemType } from "@/lib/admin/item-fields";

/** A record made here by hand starts with the library's default licence, the Zenodo licence its settings name. */
function withDefaultLicence(payload: unknown, defaultLicence: string) {
	// Whatever isn't an object goes on as it came, for the draft's validation to refuse.
	const body = Object(payload) as Record<string, unknown>;
	const record = isTopLevelAdminItemType(String(body.itemType)) && !Object.hasOwn(body, "licence");
	return record ? { ...body, licence: { kind: "zenodo", id: defaultLicence } } : payload;
}

export async function POST(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const config = await getLibraryConfig();
		const draft = await createNativeItemDraft(
			await getDatabase(),
			withDefaultLicence(await readAdminJson(request), config.services.publication.zenodo.license),
			{writebackConfig: config},
		);
		return NextResponse.json(
			{ draft: adminCanonicalDraftToItemFields(draft) },
			{ status: 201, headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
