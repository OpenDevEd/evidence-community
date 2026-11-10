import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { papersSchema } from "@/lib/admin/added-papers-manage";
import { previewPapers } from "@/lib/admin/added-papers-reads";
import { addPapers, paperLookupFor, suggestionsLeft } from "@/lib/admin/added-papers-service";
import { OpenScholarServiceError } from "@/lib/openscholar-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";
import { paperLinkOf } from "@/lib/paper-links";

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

/** A title a reader types, to find the papers it may name. */
const searchSchema = z.object({ search: z.string().trim().min(3).max(300) }).strict();
const MATCHES = 5;

/** A link, DOI or ID as the lookups take it. A link only Openscholar can follow goes as given, which asks it. */
function referenceOf(raw: string) {
	const link = paperLinkOf(raw);
	if (!link) return null;
	return link.kind === "work" ? { openalexId: link.openalexId } : link.kind === "doi" ? { doi: link.doi } : { link: raw };
}

/**
 * The paper a search names by its DOI, ID or link, and where it stands here: anyone asks, signed in or not, so the
 * results can offer to suggest one that isn't here. MOCK: the build needs a limit per visitor on this.
 */
async function paperNamed(raw: string) {
	// Each answer is read now, so none is prerendered at build time.
	await connection();
	const config = await getLibraryConfig();
	if (!config.features.readerAccounts) return readerError(404, "This community takes no suggestions.");
	const reference = referenceOf(raw.trim());
	if (!reference) return readerError(400, "Not a paper link, DOI or ID.");
	const { results } = await previewPapers((await getNativeFileRuntime()).db, config, [reference], paperLookupFor(config));
	return NextResponse.json(results[0], { headers: READER_RESPONSE_HEADERS });
}

/**
 * The papers a typed title may name, with where each stands here. MOCK: this asks OpenAlex directly. The build asks
 * Openscholar, which searches whichever index is active there, on a new service route.
 */
async function titleMatches(config: LibraryServerConfig, database: Parameters<typeof previewPapers>[0], title: string, lookup: ReturnType<typeof paperLookupFor>) {
	const url = new URL("https://api.openalex.org/works");
	url.search = new URLSearchParams({ search: title, "per-page": String(MATCHES), select: "id", api_key: config.services.openAlex?.apiKey ?? "" }).toString();
	const found = (await fetch(url).then((response) => (response.ok ? response.json() : { results: [] }))) as { results: { id: string }[] };
	const papers = found.results.map((work) => ({ openalexId: work.id.replace("https://openalex.org/", "") }));
	if (!papers.length) return { matches: [] };
	const { results } = await previewPapers(database, config, papers, lookup);
	return { matches: results.map((result, at) => ({ ...result, ref: papers[at] })).filter((match) => match.outcome !== "not_found") };
}

/** How many more papers the reader may suggest here today; or, with `?paper=`, the paper that names and where it stands here. */
export async function GET(request: Request) {
	const named = new URL(request.url).searchParams.get("paper");
	if (named !== null) return paperNamed(named);
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
	const lookup = paperLookupFor(access.config, access.actor.userId);
	const search = searchSchema.safeParse(json);
	if (search.success) return withinLookups(async () => NextResponse.json(await titleMatches(access.config, (await getNativeFileRuntime()).db, search.data.search, lookup), { headers: READER_RESPONSE_HEADERS }));
	if (!preview.success) return withinLookups(() => suggest(json, access));
	return withinLookups(async () => NextResponse.json(await previewPapers((await getNativeFileRuntime()).db, access.config, preview.data.papers, lookup), { headers: READER_RESPONSE_HEADERS }));
}

/** Openscholar's own links count against the reader's search allowance there; once it's spent, the reader is told so. */
async function withinLookups(answer: () => Promise<Response>) {
	try {
		return await answer();
	} catch (error) {
		if (error instanceof OpenScholarServiceError && error.status === 429) return readerError(429, "You've used your paper lookups on Openscholar for now. Try again later, or paste DOIs instead.");
		throw error;
	}
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
