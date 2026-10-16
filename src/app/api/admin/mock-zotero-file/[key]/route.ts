import { createHash } from "node:crypto";

import { connection, NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/permissions";
import { authorizeAdminRequest } from "@/lib/admin/access";

/**
 * Mock only, never merged: a Zotero attachment's file, read from Zotero with the source's key, so the admin mock can
 * open it and size it. `?meta=1` answers its size and hash instead of the file.
 */
const files = new Map<string, Buffer>();

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
	await connection();
	const config = await getLibraryConfig();
	const authorization = await authorizeAdminRequest(request.headers, ADMIN_CONTENT_PERMISSION, config);
	if (authorization.status !== "authorized") return new NextResponse(null, { status: 403 });
	const { key } = await params;
	if (!/^[A-Z0-9]{8}$/u.test(key)) return new NextResponse(null, { status: 400 });
	const source = config.sources.find((entry) => entry.provider === "zotero");
	if (!source || source.provider !== "zotero") return new NextResponse(null, { status: 404 });
	let bytes = files.get(key);
	if (!bytes) {
		const response = await fetch(`${source.settings.apiBaseUrl}/groups/${source.groupId}/items/${key}/file`, {
			headers: { "Zotero-API-Key": source.apiKey, "Zotero-API-Version": "3" },
		});
		if (!response.ok) return new NextResponse(null, { status: response.status });
		bytes = Buffer.from(await response.arrayBuffer());
		files.set(key, bytes);
	}
	if (request.nextUrl.searchParams.get("meta"))
		return NextResponse.json({ sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
	return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
