import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { fromError } from "zod-validation-error";

import { listAddedPapers, previewPapers } from "@/lib/admin/added-papers-reads";
import { addPapers, ADD_PAPERS_MAX } from "@/lib/admin/added-papers-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { answerOpenScholar, refusals } from "@/lib/openscholar/library-reads";

const papersSchema = z
	.array(z.object({ openalexId: z.string().max(128).nullish(), doi: z.string().max(512).nullish() }).strict())
	.min(1)
	.max(ADD_PAPERS_MAX);

/** What adding these papers would find, saving nothing: the add dialog shows it before the person confirms. */
const previewRequestSchema = z.object({ preview: z.literal(true), papers: papersSchema }).strict();

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
		papers: papersSchema,
	})
	.strict();

/** Added papers a page reads at most. */
const LIST_MAX = 100;

/** The page size asked for, from 1 to 100; 20 when none is. */
const limitOf = (value: string | null) => Math.min(LIST_MAX, Math.max(1, Number(value) || 20));

/** The community's added papers, newest first: `?cursor=` from the last page's `next`, and `?limit=` up to 100. */
export async function GET(request: Request) {
	return answerOpenScholar(request, "papers", async ({ database }) => {
		const params = new URL(request.url).searchParams;
		return { body: await listAddedPapers(database, { cursor: params.get("cursor")?.slice(0, 128) || null, limit: limitOf(params.get("limit")) }) };
	});
}

/**
 * Adds papers to the community by OpenAlex ID or DOI, published at once or sent to the review queue
 * (OpenDevEd/new-el#773). Sent again with the same `requestId`, it answers as before and adds nothing twice. With
 * `preview: true` it only looks them up.
 */
export async function POST(request: Request) {
	return answerOpenScholar(request, "papers", async ({ config }) => {
		const json = await request.json().catch(() => null);
		const preview = previewRequestSchema.safeParse(json);
		return preview.success ? { body: await previewPapers((await getNativeFileRuntime()).db, config, preview.data.papers) } : add(json, config);
	});
}

/** Adds the papers the request names, as the person OpenScholar says sent them. */
async function add(json: unknown, config: LibraryServerConfig) {
	const body = addPapersRequestSchema.safeParse(json);
	if (!body.success) return refusals.invalid(fromError(body.error).toString());
	const { actor, ...input } = body.data;
	const { db, storage } = await getNativeFileRuntime();
	try {
		return { body: await addPapers(db, storage, config, { ...input, actor: { userId: actor.clerkUserId, name: actor.name, role: actor.role } }) };
	} catch (error) {
		if (error instanceof AdminValidationError) return refusals.invalid(error.message);
		throw error;
	}
}
