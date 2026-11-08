import { z } from "zod";
import { fromError } from "zod-validation-error";

import { addPapers, ADD_PAPERS_MAX } from "@/lib/admin/added-papers-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { answerOpenScholar, refusals } from "@/lib/openscholar/library-reads";

const addPapersRequestSchema = z
	.object({
		requestId: z.string().min(1).max(128),
		publish: z.boolean(),
		// The person adding, and the role OpenScholar gives them in this community.
		actor: z
			.object({
				clerkUserId: z.string().min(1).max(128),
				name: z.string().max(255).nullable(),
				role: z.enum(["owner", "editor", "creator"]),
			})
			.strict(),
		papers: z
			.array(z.object({ openalexId: z.string().max(128).nullish(), doi: z.string().max(512).nullish() }).strict())
			.min(1)
			.max(ADD_PAPERS_MAX),
	})
	.strict();

/**
 * Adds papers to the community by OpenAlex ID or DOI, published at once or sent to the review queue
 * (OpenDevEd/new-el#773). Sent again with the same `requestId`, it answers as before and adds nothing twice.
 */
export async function POST(request: Request) {
	return answerOpenScholar(request, "papers", async ({ config }) => {
		const body = addPapersRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return refusals.invalid(fromError(body.error).toString());
		const { actor, ...input } = body.data;
		const { db, storage } = await getNativeFileRuntime();
		try {
			return { body: await addPapers(db, storage, config, { ...input, actor: { userId: actor.clerkUserId, name: actor.name, role: actor.role } }) };
		} catch (error) {
			if (error instanceof AdminValidationError) return refusals.invalid(error.message);
			throw error;
		}
	});
}
