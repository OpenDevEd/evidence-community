import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { loadLibraryConfig } from "@/config/library-config/source";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { toAdminCollection } from "@/lib/admin/library-query-service";
import {
	getAdminCollectionChildrenPage,
	resolveAdminCollections,
	searchAdminCollections,
} from "@/lib/admin/collection-catalog-service";
import { parseAdminCollectionView } from "@/lib/admin/collection-catalog-contract";
import { createAdminCollection } from "@/lib/admin/collection-mutation-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

export async function GET(request: NextRequest) {
	await connection();

	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { searchParams } = request.nextUrl;
		const view = parseAdminCollectionView(
			searchParams.get("view") ?? "children",
		);
		const database = await getDatabase();
		if (view === "children") {
			const parent = searchParams.get("parent");
			return NextResponse.json(
				await getAdminCollectionChildrenPage(database, {
					cursor: searchParams.get("cursor"),
					pageSize: searchParams.get("pageSize") ?? undefined,
					parentCollection:
						!parent || parent === "root" ? null : parent,
					sourceConnectionKey:
						searchParams.get("source") ?? undefined,
				}),
				{ headers: ADMIN_RESPONSE_HEADERS },
			);
		}
		if (view === "search") {
			return NextResponse.json(
				await searchAdminCollections(database, {
					cursor: searchParams.get("cursor"),
					pageSize: searchParams.get("pageSize") ?? undefined,
					query: searchParams.get("query") ?? undefined,
					sourceConnectionKey: searchParams.get("source"),
					state: searchParams.get("state") ?? undefined,
				}),
				{ headers: ADMIN_RESPONSE_HEADERS },
			);
		}
		if (view === "resolve") {
			return NextResponse.json(
				{
					items: await resolveAdminCollections(
						database,
						searchParams.getAll("key"),
					),
				},
				{ headers: ADMIN_RESPONSE_HEADERS },
			);
		}
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function POST(request: NextRequest) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const collection = await createAdminCollection(
			await getDatabase(),
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
			{ status: 201, headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
