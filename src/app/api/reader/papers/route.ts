import { createHash } from "node:crypto";

import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { papersSchema } from "@/lib/admin/added-papers-manage";
import { previewPapers } from "@/lib/admin/added-papers-reads";
import { addPapers, paperLookupFor, suggestionsLeft } from "@/lib/admin/added-papers-service";
import { consumeConfiguredRateLimit } from "@/lib/ai/rate-limit";
import { OpenScholarServiceError, papersByTitle } from "@/lib/openscholar-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";
import { paperLinkOf } from "@/lib/paper-links";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { item } from "@/db/schema/tables/item";

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

/** A link, DOI or ID as the lookups take it. A link only Openscholar can follow goes as given, which asks it. */
function referenceOf(raw: string) {
	const link = paperLinkOf(raw);
	if (!link) return null;
	return link.kind === "work" ? { openalexId: link.openalexId } : link.kind === "doi" ? { doi: link.doi } : { link: raw };
}

/** Lookups one visitor who isn't signed in makes of the papers their searches name: each reads OpenAlex with the community's own key. */
async function visitorMayLookUp(request: Request, config: LibraryServerConfig) {
	const ip = request.headers.get("x-real-ip")?.slice(0, 128) || "unresolved-client";
	// The identity is the address itself, the same on every request, so every window counts against it, the day's too.
	const limit = await consumeConfiguredRateLimit({ clientId: createHash("sha256").update(ip).digest("hex"), clientIp: ip, persistentClient: true }, config, {
		clientWindows: [{ name: "minute", limit: 10, windowMs: 60_000 }, { name: "day", limit: 200, windowMs: 86_400_000 }],
		networkWindow: { name: "minute", limit: 120, windowMs: 60_000 },
		keyPrefix: `evidence-library:paper-lookups:${config.authentication.openScholar.libraryId}`,
	}).catch((error: unknown) => {
		// Without the limiter, a visitor's lookups aren't made rather than made without a limit.
		console.error("Paper lookup limit unavailable", { error: String(error) });
		return { allowed: false };
	});
	return limit.allowed;
}

/** Why a visitor who isn't signed in isn't answered, if they aren't: a link only Openscholar can follow is read for a signed-in reader alone, whose allowance there it counts against, and a visitor's lookups are limited. */
async function visitorRefusal(request: Request, config: LibraryServerConfig, reference: NonNullable<ReturnType<typeof referenceOf>>) {
	if ("link" in reference) return readerError(401, "Sign in with Openscholar to look this link up.");
	if (await visitorMayLookUp(request, config)) return null;
	return readerError(429, "Too many lookups for now. Try again in a minute.");
}

/** The paper a search names, as asked: what to look up in which community, or the refusal for a search that names none or a community that takes no suggestions. */
async function namedPaper(raw: string) {
	// Each answer is read now, so none is prerendered at build time.
	await connection();
	const config = await getLibraryConfig();
	if (!config.features.readerAccounts) return { refusal: readerError(404, "This community takes no suggestions.") };
	const reference = referenceOf(raw.trim());
	return reference ? { config, reference } : { refusal: readerError(400, "Not a paper link, DOI or ID.") };
}

/**
 * The paper a search names by its DOI, ID or link, and where it stands here: anyone asks, signed in or not, so the
 * results can offer to suggest one that isn't here.
 */
async function paperNamed(request: Request, raw: string) {
	const asked = await namedPaper(raw);
	if ("refusal" in asked) return asked.refusal;
	const { config, reference } = asked;
	const reader = await getSignedInOpenScholarUser(request.headers, config);
	const refused = reader ? null : await visitorRefusal(request, config, reference);
	if (refused) return refused;
	return withinLookups(async () => {
		const { db } = await getNativeFileRuntime();
		const { results } = await previewPapers(db, config, [reference], paperLookupFor(config, reader?.clerkUserId));
		const [named] = results;
		return NextResponse.json({ ...named, itemKey: await openableKey(db, config, named?.itemKey) }, { headers: READER_RESPONSE_HEADERS });
	});
}

/**
 * A record's key when anyone may open its page. A record the team took down, or keeps hidden, is still the
 * community's, so the paper counts as here, but it has no page to send a reader to.
 */
async function openableKey(database: Parameters<typeof previewPapers>[0], config: LibraryServerConfig, itemKey: string | undefined) {
	if (!itemKey) return undefined;
	const [open] = await database.select({ key: item.key }).from(item).where(and(eq(item.key, itemKey), publicParentVisibility(database, config.content.tags.hidden))).limit(1);
	return open?.key;
}

/**
 * The papers a typed title may name, with where each stands here. Openscholar finds them on the index its own search
 * reads, as the reader's search, and each is then looked up as a pasted paper is.
 */
async function titleMatches({ config, actor }: { config: LibraryServerConfig; actor: Actor }, title: string) {
	const found = await papersByTitle(config.authentication.openScholar, title, actor.userId).catch((error: unknown) => {
		// Their allowance spent is said as that (`withinLookups`); any other failure is Openscholar's search being out of reach.
		if (error instanceof OpenScholarServiceError && error.status === 429) throw error;
		console.error("Title search unavailable", { error: String(error) });
		throw new AdminValidationError("Couldn't search by title just now. Paste the paper's DOI or link instead.");
	});
	const papers = found.map((paper) => (paper.openalexId ? { openalexId: paper.openalexId } : { doi: paper.doi! }));
	if (!papers.length) return { matches: [] };
	const { results } = await previewPapers((await getNativeFileRuntime()).db, config, papers, paperLookupFor(config, actor.userId));
	return { matches: results.map((result, at) => ({ ...result, ref: papers[at] })).filter((match) => match.outcome !== "not_found") };
}

/** How many more papers the reader may suggest here today; or, with `?paper=`, the paper that names and where it stands here. */
export async function GET(request: Request) {
	const named = new URL(request.url).searchParams.get("paper");
	if (named !== null) return paperNamed(request, named);
	const access = await suggesterOf(request);
	if (access.response) return access.response;
	return NextResponse.json({ left: Math.max(0, await suggestionsLeft(access.database, access.actor)) }, { headers: READER_RESPONSE_HEADERS });
}

/**
 * Finds the papers a title may name, looks up papers a reader pastes, or sends them to the community's review queue as
 * their suggestions: the team reviews each, and the reader follows them in Openscholar's Your submissions.
 */
export async function POST(request: Request) {
	const access = await suggesterOf(request);
	if (access.response) return access.response;
	const json = await readJsonBody(request);
	const search = searchSchema.safeParse(json);
	if (search.success) return withinLookups(async () => NextResponse.json(await titleMatches(access, search.data.search), { headers: READER_RESPONSE_HEADERS }));
	const preview = previewSchema.safeParse(json);
	if (!preview.success) return withinLookups(() => suggest(json, access));
	const lookup = paperLookupFor(access.config, access.actor.userId);
	return withinLookups(async () => NextResponse.json(await previewPapers((await getNativeFileRuntime()).db, access.config, preview.data.papers, lookup), { headers: READER_RESPONSE_HEADERS }));
}

/** What a failed lookup tells the reader: the community's own refusal as given, or that their Openscholar allowance is spent. Null for a failure that isn't theirs to hear. */
function lookupRefusal(error: unknown) {
	if (error instanceof AdminValidationError) return readerError(400, error.message);
	const spent = error instanceof OpenScholarServiceError && error.status === 429;
	return spent ? readerError(429, "You've used your paper lookups on Openscholar for now. Try again later, or paste DOIs instead.") : null;
}

/** Openscholar's own links and its search count against the reader's search allowance there; once it's spent, the reader is told so. */
async function withinLookups(answer: () => Promise<Response>) {
	try {
		return await answer();
	} catch (error) {
		const refusal = lookupRefusal(error);
		if (refusal) return refusal;
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
