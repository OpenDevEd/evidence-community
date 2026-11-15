import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { getAdminReviewSnapshot } from "@/lib/admin/review-query";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_PUBLISH_PERMISSION,
	adminRoleHasPermission,
} from "@/lib/admin/access";
import {
	ADMIN_RESPONSE_HEADERS,
	handleAdminResponse,
	handleAdminJson,
	adminForbiddenResponse,
	readAdminJson,
} from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	resolveReviewConflicts,
	approveItemReview,
	correctItemReview,
	resolveItemReview,
} from "@/lib/admin/review-service";
import { reviewRecordSchema } from "@/lib/admin/review-contract";

const revision = z.number().int().positive();
const bodySchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("approve"),
		expectedRevision: revision,
		zenodoFileChange: z.literal("minor_correction").optional(),
	}),
	z.object({
		action: z.literal("correct"),
		expectedRevision: revision,
		records: z.array(reviewRecordSchema),
	}),
	z.object({
		action: z.enum(["returned", "withdrawn"]),
		expectedRevision: revision,
		note: z.string().max(4000).optional(),
	}),
	z.object({
		action: z.literal("resolve-conflicts"),
		expectedRevision: revision,
		itemKey: z.string().length(8),
		generation: z.string().uuid(),
		draftRevision: revision,
		choices: z.record(z.string(), z.enum(["draft", "published"])),
	}),
]);
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	return handleAdminResponse(
		request,
		ADMIN_CONTENT_PERMISSION,
		async (session) => {
			const body = bodySchema.parse(await readAdminJson(request));
			const permission = ["approve", "correct", "returned"].includes(
				body.action,
			)
				? ADMIN_PUBLISH_PERMISSION
				: ADMIN_CONTENT_PERMISSION;
			if (!adminRoleHasPermission(session.role, permission))
				return adminForbiddenResponse(permission);
			const [{ id }, runtime] = await Promise.all([
				params,
				getNativeFileRuntime(),
			]);
			const reviewId = z.string().uuid().parse(id);
			const actor = {
				userId: session.clerkUserId,
				role: session.role,
			};
			const input = { ...body, reviewId };
			if (input.action === "approve") {
				const approved = await approveItemReview(
					runtime.db,
					runtime.storage,
					input,
					actor,
					runtime.config,
				);
				return NextResponse.json(
					{
						review: approved.review,
						indexingReceipts: approved.indexingRecords.map(
							(record) => adminSearchIndexReceipt("item", record),
						),
					},
					{ headers: ADMIN_RESPONSE_HEADERS },
				);
			}
			const review = await resolveSubmittedReview(runtime, input, actor);
			return NextResponse.json(
				{ review },
				{ headers: ADMIN_RESPONSE_HEADERS },
			);
		},
	);
}

type ReviewResolution = Exclude<
	z.infer<typeof bodySchema>,
	{ action: "approve" }
> & { reviewId: string };
function resolveSubmittedReview(
	runtime: Awaited<ReturnType<typeof getNativeFileRuntime>>,
	input: ReviewResolution,
	actor: import("@/lib/admin/review-service").ReviewActor,
) {
	if (input.action === "correct")
		return correctItemReview(runtime.db, input, actor);
	if (input.action === "resolve-conflicts")
		return resolveReviewConflicts(runtime.db, input, runtime.config);
	return resolveItemReview(runtime.db, input, actor);
}

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async (session) => {
		const [{ id }, runtime] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		return {
			snapshot: await getAdminReviewSnapshot(
				runtime.db,
				z.string().uuid().parse(id),
				{ senderEmail: adminRoleHasPermission(session.role, ADMIN_PUBLISH_PERMISSION) },
			),
		};
	});
}
