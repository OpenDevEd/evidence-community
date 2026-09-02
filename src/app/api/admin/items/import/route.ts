import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import { AdminValidationError } from "@/lib/admin/errors";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import {
	adminImportRequestSchema,
	type AdminImportRequest,
} from "@/lib/admin/item-import-contract";
import {
	commitImportRecords,
	previewImportRecords,
} from "@/lib/admin/item-import-service";

async function requireTranslationUrl() {
	const translationUrl = (await getLibraryConfig()).services.zotero
		.translationUrl;
	if (!translationUrl) {
		throw new AdminValidationError(
			"Importing records needs a Zotero Translation Server. Add one to the library configuration first.",
		);
	}
	return translationUrl;
}

async function runImport(input: AdminImportRequest) {
	const db = await getDatabase();
	if (input.action === "commit") return commitImportRecords(db, input);
	return previewImportRecords(db, input, await requireTranslationUrl());
}

export async function POST(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const input = adminImportRequestSchema.parse(await readAdminJson(request));
		return NextResponse.json(await runImport(input), {
			headers: ADMIN_RESPONSE_HEADERS,
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}
