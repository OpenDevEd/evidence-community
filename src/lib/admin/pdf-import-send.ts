import { itemDraft } from "@opendeved/evidence-library-core";
import { and, eq } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { pdfImport, type ImportSend } from "@/db/schema/pdf-import";
import { itemReview } from "@/db/schema/review";
import { reserveCrossrefDoi } from "@/lib/publication/crossref-activation-service";

import type { EvidenceFileStorage } from "./file-storage";
import { applyItemDraftPatch } from "./item-draft-merge";
import type { AdminImportCommitResult } from "./item-import-contract";
import { routeChoice } from "./review-contract";
import { approveItemReview, setItemPublishingChoice, submitItemReview } from "./review-service";
import { needsText, publishingNeeds } from "./review-validation";

// The worker's side of an import that sends its drafts on: once a draft has its PDF, it goes on as the editor who
// imported it, as the finish step's Publish or Submit would send it.

type Sending = NonNullable<ImportSend>;
type Sent = { error: string | null; state: "held" | "sent" };

/** What the import sends the draft as: how, and whether it was made in the library (it takes the route) or kept its DOI. */
export async function sendingOf(db: Database, importId: string, position: number) {
	const [found] = await db.select({ results: pdfImport.results, send: pdfImport.send }).from(pdfImport).where(eq(pdfImport.id, importId));
	const result = found?.results?.find(({ id }) => id === String(position));
	return found?.send && result?.itemKey ? { itemKey: result.itemKey, kind: result.kind, send: found.send } : null;
}

const pendingReview = async (db: Database, itemKey: string) =>
	(await db.select({ id: itemReview.id, revision: itemReview.revision }).from(itemReview).where(and(eq(itemReview.itemKey, itemKey), eq(itemReview.state, "pending"))))[0];

/** Gives a draft made in the library the import's DOI route, reserving its Crossref DOI on that route. */
async function chooseRoute(db: Database, itemKey: string, route: Sending["route"], send: Sending, config: LibraryServerConfig) {
	await setItemPublishingChoice(db, itemKey, routeChoice(route), config);
	if (route === "crossref-zenodo") await reserveCrossrefDoi(db, itemKey, config, send.actor.userId);
}

/**
 * Sends one imported draft on: held, with why, when it lacks something its
 * route needs, so no DOI is reserved for it; otherwise its route is saved,
 * it is submitted (or its review still pending is taken up again) and, by an
 * editor or owner, approved. A draft no longer there was published already.
 */
export async function sendImportedDraft(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, draft: { itemKey: string; kind: AdminImportCommitResult["kind"]; send: Sending }): Promise<Sent> {
	const { itemKey, kind, send } = draft;
	const [current] = await db.select({ patch: itemDraft.patch }).from(itemDraft).where(eq(itemDraft.itemKey, itemKey));
	if (!current) return { error: null, state: "sent" };
	// A record imported with a DOI keeps it.
	const route = kind === "created" ? send.route : null;
	const needs = publishingNeeds(applyItemDraftPatch({}, current.patch as Record<string, unknown>), routeChoice(route));
	if (Object.keys(needs).length) return { error: needsText(needs), state: "held" };
	if (kind === "created") await chooseRoute(db, itemKey, route, send, config);
	const review = (await pendingReview(db, itemKey)) ?? (await submitItemReview(db, itemKey, send.actor, config));
	if (send.actor.role !== "creator") await approveItemReview(db, storage, { expectedRevision: review.revision, publicationTags: config.content.tags.publish, reviewId: review.id }, send.actor, config);
	return { error: null, state: "sent" };
}
