import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { fromError } from "zod-validation-error";

import { actorSchema, addedPapersSettings, papersSchema, setAddedPapersSettings } from "@/lib/admin/added-papers-manage";
import { listAddedPapers, previewPapers } from "@/lib/admin/added-papers-reads";
import { addPapers } from "@/lib/admin/added-papers-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { answerOpenScholar, refusals } from "@/lib/openscholar/library-reads";

/** What adding these papers would find, saving nothing: the add dialog shows it before the person confirms. */
const previewRequestSchema = z.object({ preview: z.literal(true), papers: papersSchema }).strict();

const addPapersRequestSchema = z.object({ requestId: z.string().min(1).max(128), publish: z.boolean(), actor: actorSchema, papers: papersSchema }).strict();

/** Pauses or resumes the source, or turns its PDFs on or off. */
const settingsRequestSchema = z
	.object({ enabled: z.boolean().optional(), downloadPdfs: z.boolean().optional() })
	.strict()
	.refine((change) => change.enabled !== undefined || change.downloadPdfs !== undefined, "Change enabled, downloadPdfs or both.");

/** Added papers a page reads at most. */
const LIST_MAX = 100;

/** The page size asked for, from 1 to 100; 20 when none is. */
const limitOf = (value: string | null) => Math.min(LIST_MAX, Math.max(1, Number(value) || 20));

/**
 * The community's added papers, newest first: `?cursor=` from the last page's `next`, and `?limit=` up to 100. With
 * them, whether the source syncs and fetches PDFs.
 */
export async function GET(request: Request) {
	return answerOpenScholar(request, "papers", async ({ database }) => {
		const params = new URL(request.url).searchParams;
		const list = await listAddedPapers(database, { cursor: params.get("cursor")?.slice(0, 128) || null, limit: limitOf(params.get("limit")) });
		return { body: { ...list, settings: await addedPapersSettings(database) } };
	});
}

/** Pauses or resumes the Added papers source, or turns its PDFs on or off. OpenScholar lets only the owner. */
export async function PATCH(request: Request) {
	return answerOpenScholar(request, "papers settings", async ({ database }) => {
		const body = settingsRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return refusals.invalid(fromError(body.error).toString());
		return { body: { settings: await setAddedPapersSettings(database, body.data) } };
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
		return { body: await addPapers(db, storage, config, { ...input, actor: { userId: actor.clerkUserId, name: actor.name, email: actor.email, role: actor.role } }) };
	} catch (error) {
		if (error instanceof AdminValidationError) return refusals.invalid(error.message);
		throw error;
	}
}
