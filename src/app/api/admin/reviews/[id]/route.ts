import { getAdminReviewSnapshot } from "@/lib/admin/review-query";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_CONTENT_PERMISSION, ADMIN_PUBLISH_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, readAdminJson, readAdminPermission } from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { acknowledgeReviewConflicts, approveItemReview, correctItemReview, resolveItemReview } from "@/lib/admin/review-service";
import { reviewRecordSchema } from "@/lib/admin/review-contract";

const revision = z.number().int().positive();
const bodySchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("approve"), expectedRevision: revision, zenodoFileChange: z.literal("minor_correction").optional() }),
	z.object({ action: z.literal("correct"), expectedRevision: revision, records: z.array(reviewRecordSchema) }),
	z.object({ action: z.enum(["returned", "withdrawn"]), expectedRevision: revision, note: z.string().max(4000).optional() }),
	z.object({ action: z.literal("resolve-conflicts"), expectedRevision: revision, drafts: z.array(z.object({ itemKey: z.string().length(8), generation: z.string().uuid().nullable(), draftRevision: revision.nullable() })) }),
]);
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	try {
		const body = bodySchema.parse(await readAdminJson(request));
		const permission = ["approve", "correct", "returned"].includes(body.action) ? ADMIN_PUBLISH_PERMISSION : ADMIN_CONTENT_PERMISSION;
		const access = await readAdminPermission(request, permission);
		if (access.denied) return access.denied;
		const [{ id }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const reviewId = z.string().uuid().parse(id);
		const actor = { userId: access.session.clerkUserId, role: access.session.role };
		const input = { ...body, reviewId };
		const review = input.action === "approve"
			? await approveItemReview(runtime.db, runtime.storage, { ...input, publicationTags: runtime.config.content.tags.publish }, actor, { writebackConfig: runtime.config })
			: input.action === "correct"
				? await correctItemReview(runtime.db, input, actor)
				: input.action === "resolve-conflicts"
					? await acknowledgeReviewConflicts(runtime.db, input)
					: await resolveItemReview(runtime.db, input, actor);
		return NextResponse.json({ review }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	try {
		const [{ id }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		return NextResponse.json({ snapshot: await getAdminReviewSnapshot(runtime.db, z.string().uuid().parse(id)) }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
