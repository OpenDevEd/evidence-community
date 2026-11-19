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
import { defaultFileAccessOf, type FileAccess, type RecordLicence } from "@/lib/licences";

/** The community's default for who gets the files, as a field a record starts with: none when its licence decides. */
const defaultFileAccessField = (mode: Parameters<typeof defaultFileAccessOf>[0]) => {
	const fileAccess = defaultFileAccessOf(mode);
	return fileAccess ? { fileAccess } : {};
};

/**
 * A record made here by hand starts with the library's default licence, the Zenodo licence its settings name, and its
 * default for who gets the files.
 */
function withDefaults(payload: unknown, defaults: { licence: RecordLicence; fileAccess?: FileAccess }) {
	// Whatever isn't an object goes on as it came, for the draft's validation to refuse.
	const body = Object(payload) as Record<string, unknown>;
	// Each only where the record doesn't say its own.
	return isTopLevelAdminItemType(String(body.itemType)) ? { ...defaults, ...body } : payload;
}

export async function POST(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const config = await getLibraryConfig();
		const draft = await createNativeItemDraft(
			await getDatabase(),
			withDefaults(await readAdminJson(request), { licence: { kind: "zenodo", id: config.services.publication.zenodo.license }, ...defaultFileAccessField(config.services.publication.zenodo.defaultFileAccess) }),
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
