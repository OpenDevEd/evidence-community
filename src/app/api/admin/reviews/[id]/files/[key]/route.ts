import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { itemReviewFile } from "@/db/schema/review";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, readAdminPermission } from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { ItemNotFoundError } from "@/lib/admin/native-item-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	try {
		const [{ id, key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const [file] = await runtime.db.select().from(itemReviewFile).where(and(eq(itemReviewFile.reviewId, z.string().uuid().parse(id)), eq(itemReviewFile.itemKey, key)));
		if (!file?.file || !file.objectPath) throw new ItemNotFoundError(key);
		const bytes = await runtime.storage.downloadPrivate(file.objectPath);
		return new NextResponse(new Uint8Array(bytes), { headers: { ...ADMIN_RESPONSE_HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.file.filename)}`, "X-Content-Type-Options": "nosniff" } });
	} catch (error) { return adminErrorResponse(error); }
}
