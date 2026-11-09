import { NextResponse } from "next/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { papersSchema } from "@/lib/admin/added-papers-manage";
import { previewPapers } from "@/lib/admin/added-papers-reads";
import { addPapers, suggestionsLeft } from "@/lib/admin/added-papers-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";

/** What suggesting these papers would find, saving nothing: the dialog shows it before the reader sends them. */
const previewSchema = z.object({ preview: z.literal(true), papers: papersSchema }).strict();
/** The papers to send, under a request ID the dialog makes once, so sending again adds nothing twice. */
const suggestSchema = z.object({ requestId: z.string().min(1).max(128), papers: papersSchema }).strict();

type Actor = { userId: string; name: string; role: "reader" };

/** The signed-in reader as Openscholar knows them, who suggests papers as someone outside the team (#777). */
async function suggesterOf(request: Request) {
	const access = await readReaderRequest(request);
	if (access.response) return access;
	const person = await getSignedInOpenScholarUser(request.headers, access.config);
	if (!person) return { response: readerError(401, "Sign in with Openscholar to suggest papers.") };
	const actor: Actor = { userId: person.clerkUserId, name: person.name, role: "reader" };
	return { ...access, actor };
}

/** How many more papers the reader may suggest here today. */
export async function GET(request: Request) {
	const access = await suggesterOf(request);
	if (access.response) return access.response;
	return NextResponse.json({ left: Math.max(0, await suggestionsLeft(access.database, access.actor)) }, { headers: READER_RESPONSE_HEADERS });
}

/**
 * Looks up papers a reader pastes, or sends them to the community's review queue as their suggestions: the team
 * reviews each, and the reader follows them in Openscholar's Your submissions.
 */
export async function POST(request: Request) {
	const access = await suggesterOf(request);
	if (access.response) return access.response;
	const json = await readJsonBody(request);
	const preview = previewSchema.safeParse(json);
	if (!preview.success) return suggest(json, access);
	return NextResponse.json(await previewPapers((await getNativeFileRuntime()).db, access.config, preview.data.papers), { headers: READER_RESPONSE_HEADERS });
}

/** Sends the papers to the review queue as the reader's suggestions; a refusal, such as the day's limit, is said as given. */
async function suggest(json: unknown, { config, actor }: { config: LibraryServerConfig; actor: Actor }) {
	const body = suggestSchema.safeParse(json);
	if (!body.success) return readerError(400, fromError(body.error).toString());
	const { db, storage } = await getNativeFileRuntime();
	try {
		return NextResponse.json(await addPapers(db, storage, config, { ...body.data, publish: false, actor }), { headers: READER_RESPONSE_HEADERS });
	} catch (error) {
		if (error instanceof AdminValidationError) return readerError(400, error.message);
		throw error;
	}
}
