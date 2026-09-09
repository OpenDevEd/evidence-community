import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { loadLibraryConfig } from "@/config/library-config/source";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminPublisher,
} from "@/lib/admin/http";
import { toAdminCollection } from "@/lib/admin/library-query-service";
import {
	deleteAdminCollection,
	renameAdminCollection,
} from "@/lib/admin/collection-mutation-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

type RouteContext = { params: Promise<{ key: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminPublisher(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const collection = await renameAdminCollection(
			await getDatabase(),
			key,
			await readAdminJson(request),
			{ writebackConfig: await loadLibraryConfig() },
		);
		return NextResponse.json(
			{
				collection: toAdminCollection(collection),
				indexingReceipts: [
					adminSearchIndexReceipt("collection", collection),
				],
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminPublisher(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const collections = await deleteAdminCollection(
			await getDatabase(),
			key,
			await readAdminJson(request),
			{ writebackConfig: await loadLibraryConfig() },
		);
		return NextResponse.json(
			{
				collections: collections.map(toAdminCollection),
				indexingReceipts: collections.map((collection) =>
					adminSearchIndexReceipt("collection", collection),
				),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
