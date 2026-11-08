import { z } from "zod";
import { fromError } from "zod-validation-error";

import { actorSchema, removeAddedPaper } from "@/lib/admin/added-papers-manage";
import { AdminValidationError } from "@/lib/admin/errors";
import { answerOpenScholar, refusals } from "@/lib/openscholar/library-reads";

const removeRequestSchema = z.object({ actor: actorSchema }).strict();

/**
 * Takes an added paper off the community: withdrawn from the review queue while it waits, unpublished once it's on the
 * community. Answers `{ outcome: "withdrawn" | "removed" }`.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ key: string }> }) {
	return answerOpenScholar(request, "papers remove", async ({ database }) => {
		const body = removeRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return refusals.invalid(fromError(body.error).toString());
		const { actor } = body.data;
		try {
			return { body: { outcome: await removeAddedPaper(database, (await params).key, { userId: actor.clerkUserId, role: actor.role }) } };
		} catch (error) {
			if (error instanceof AdminValidationError) return refusals.invalid(error.message);
			throw error;
		}
	});
}
