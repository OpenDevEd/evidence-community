"use client";

import { AlertCircleIcon, InboxIcon, Loading03Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import type { AdminFieldErrors } from "@/lib/admin/errors";

import { publicationPresentation } from "./AdminPublicationStatus";
import { creatorsLine } from "./ImportReview";
import { appliedOf, checkPasses, draftNeeds, heldRoute, needsText, reviewChecks, routeOf, rowPasses, serverSending, type AttachState, type ImportBatch, type ImportRow, type PublishState } from "./admin-import";
import { useAdminPublication } from "./useAdminPublication";

/** A new draft, with what it still needs to publish on the route it takes. */
type Draft = { applied: ReadonlySet<number>; itemKey: string; kind: "created" | "imported" | undefined; needs: AdminFieldErrors; row: ImportRow };

const note = "flex min-w-0 items-center gap-1.5 text-xs";

/** A published draft's DOI, polled and labelled as the record inspector's header shows it. */
function PublishedDoi({ itemKey }: { itemKey: string }) {
	const { publication } = useAdminPublication(itemKey);
	if (!publication) return <span className="text-xs text-black/45 dark:text-white/45">Published</span>;
	const { Icon, color, label, spin } = publicationPresentation(publication);
	const doi = publication.identifiers.doi?.value;
	return (
		<span className={`${note} animate-fade-in ${color}`}>
			<HugeiconsIcon aria-hidden className={`shrink-0 ${spin ? "animate-spin motion-reduce:animate-none" : ""}`} icon={Icon} size={13} />
			<span className="shrink-0">{label}</span>
			{doi ? <span className="min-w-0 truncate font-mono text-[11px] text-black/60 dark:text-white/60">{doi}</span> : null}
		</span>
	);
}

/** Where a new draft stands: on its way, published with its DOI, waiting for an editor, what it needs before it can go, or who wrote it. */
type ServerSend = ImportBatch["sending"][string];

export function DraftState({ attach, draft, publish, server, verbs }: { attach: AttachState | undefined; draft: Draft; publish: PublishState | undefined; server?: ServerSend; verbs: SendVerbs }) {
	if (publish && publish.state !== "failed") return <SentState itemKey={draft.itemKey} publish={publish} verbs={verbs} />;
	if (attach === "failed") return <AlertNote text="The PDF didn't attach, so it stays a draft" />;
	// The server sending it on, unless this tab has sent it again since. One it held shows what it needs on the route
	// chosen now, below, which may be another.
	if (server && !publish && server.state !== "held") return <ServerSendState attached={attach === "attached"} itemKey={draft.itemKey} server={server} verbs={verbs} />;
	// Completed in the record editor; the import's status says once it is. What it needs now outranks why an earlier
	// send failed, which may have been on another route.
	if (Object.keys(draft.needs).length) return <AlertNote text={needsText(draft.needs)} tone="text-amber-700 dark:text-amber-400" />;
	if (publish) return <SentState itemKey={draft.itemKey} publish={publish} verbs={verbs} />;
	return <DraftAuthors row={draft.row} />;
}

/**
 * A draft the server sends on as its PDF is attached: waiting for the PDF,
 * on its way, or failed, with why. Sent ones show as published or submitted
 * from the import's status.
 */
function ServerSendState({ attached, itemKey, server, verbs }: { attached: boolean; itemKey: string; server: ServerSend; verbs: SendVerbs }) {
	if (server.state !== "waiting") return <AlertNote text={server.message ?? "It couldn't be sent on"} />;
	if (attached) return <SentState itemKey={itemKey} publish={{ state: "sending" }} verbs={verbs} />;
	return <span className={`${note} text-black/45 dark:text-white/45`}>Waiting for its PDF</span>;
}

/** A draft sent on from the finish step: on its way, published, waiting for an editor, or failed. */
function SentState({ itemKey, publish, verbs }: { itemKey: string; publish: PublishState; verbs: SendVerbs }) {
	if (publish.state === "published") return <PublishedDoi itemKey={itemKey} />;
	if (publish.state === "failed") return <AlertNote text={publish.message ?? "The PDF didn't attach, so it stays a draft"} />;
	if (publish.state === "submitted") {
		return (
			<span className={`${note} animate-fade-in text-black/55 dark:text-white/55`}>
				<HugeiconsIcon aria-hidden className="shrink-0" icon={InboxIcon} size={13} />
				<span className="shrink-0">Waiting for an editor</span>
				{publish.doi ? <span className="min-w-0 truncate font-mono text-[11px]">{publish.doi}</span> : null}
			</span>
		);
	}
	return (
		<span className={`${note} text-black/50 dark:text-white/50`}>
			<HugeiconsIcon aria-hidden className="animate-spin motion-reduce:animate-none" icon={Loading03Icon} size={13} />
			{verbs.doing}
		</span>
	);
}

function AlertNote({ text, tone = "text-danger" }: { text: string; tone?: string }) {
	return (
		<span className={`${note} ${tone}`}>
			<HugeiconsIcon aria-hidden className="shrink-0" icon={AlertCircleIcon} size={13} />
			{/* One line, as every other state, so a failure doesn't make the row taller. */}
			<TruncatedText className="min-w-0" focusable text={text} />
		</span>
	);
}

/** A draft not sent on: who wrote it, as the review's list shows a ready record. Its checks show beside it. */
function DraftAuthors({ row }: { row: ImportRow }) {
	return <span className="block truncate text-xs text-black/50 dark:text-white/50">{creatorsLine(row.record?.creators ?? []) || "No authors"}</span>;
}

/**
 * The finish step's words for the role, as anywhere in the admin: editors
 * and owners publish (submit and approve at once), and everyone else
 * submits for an editor to approve.
 */
function sendVerbs(canPublish: boolean) {
	return canPublish
		? { act: "Publish", after: "", doing: "Publishing", done: "published", to: "to publish" }
		: { act: "Send", after: " to the queue", doing: "Sending to the queue", done: "sent to the queue", to: "to send to the queue" };
}

type SendVerbs = ReturnType<typeof sendVerbs>;

/**
 * Where sending stands: the drafts already published or submitted, which
 * can't go again, and whether a run holds the ticks while it sends. Once it
 * is done, drafts it failed on and drafts whose PDF came later can go. The
 * DOI route stays as it is while a draft it failed on still has its review
 * pending, since trying again approves that review; once an editor
 * withdraws or returns it, the route can change.
 */
function sending(batch: ImportBatch) {
	const states = [...batch.publish.values()];
	const sentIds = new Set([...batch.publish].filter(([, { state }]) => state === "published" || state === "submitted").map(([id]) => id));
	const started = states.some(({ state }) => state === "sending");
	// The server sending the drafts on holds the route too, until it has.
	return { routeHeld: started || heldRoute(batch) !== undefined, sentIds, started };
}

/** How far a draft is from going on: 0 it can't until something is fixed, 1 it can or is on its way, 2 it went. */
function draftStage(batch: ImportBatch, sentIds: ReadonlySet<string>, { needs, row }: Draft) {
	if (sentIds.has(row.id)) return 2;
	return row.source && batch.attach.get(row.id) !== "failed" && !Object.keys(needs).length ? 1 : 0;
}

const passingChecks = ({ applied, row }: Draft) => reviewChecks(row, applied).filter(checkPasses).length;

/** The list's order, worst first: by stage, then the fewest passing checks. A draft moves as it goes on, never as it's ticked. */
const byStage = (batch: ImportBatch, sentIds: ReadonlySet<string>) => (a: Draft, b: Draft) => draftStage(batch, sentIds, a) - draftStage(batch, sentIds, b) || passingChecks(a) - passingChecks(b);

/**
 * What the finish screen knows: the new drafts, which are ticked to publish
 * or submit, and how the import went. Drafts read from a PDF can go once
 * their PDF is attached; the ones that pass every check start ticked, and
 * the person importing decides on the rest.
 */
export function publishView(batch: ImportBatch, onChoose: (ids: ReadonlySet<string>) => void, canPublish: boolean) {
	const results = batch.results ?? [];
	const rowById = new Map(batch.rows.map((row) => [row.id, row]));
	const drafts: Draft[] = results.flatMap(({ id, itemKey, kind, outcome }) => (outcome === "created" && itemKey && rowById.has(id) ? [{ applied: appliedOf(batch, rowById.get(id)!), itemKey, kind, needs: draftNeeds(batch.needs, routeOf(batch), id, kind), row: rowById.get(id)! }] : []));
	// While the server sends the drafts on, it does as the person who imported them could, whoever looks now.
	// The rows and the progress name the send this tab started; the button always says what it does itself.
	const verbs = sendVerbs(batch.send && serverSending(batch) ? batch.send.action === "publish" : (batch.sendApproves ?? canPublish));
	const act = sendVerbs(canPublish);
	const { routeHeld, sentIds, started } = sending(batch);
	// A draft goes on with its PDF, so only one whose PDF is attached can, and one already sent can't go again. One that
	// still needs a field the route asks for waits until the editor completes it in the record.
	const publishable = drafts.filter(({ needs, row }) => row.source && batch.attach.get(row.id) === "attached" && !sentIds.has(row.id) && !Object.keys(needs).length && batch.sending[row.id]?.state !== "waiting");
	const publishableIds = publishable.map(({ row }) => row.id);
	// Once sending starts, the ticks are the drafts it was started for. Before
	// that, a ticked draft whose PDF then fails to attach drops out.
	const chosen = started ? new Set(batch.publish.keys()) : new Set((batch.toPublish ? [...batch.toPublish] : publishable.filter(({ applied, row }) => rowPasses(row, applied)).map(({ row }) => row.id)).filter((id) => publishableIds.includes(id)));
	const sent = [...batch.publish.values()].filter(({ state }) => state === "published" || state === "submitted").length;
	const pdfs = drafts.filter(({ row }) => row.source).map(({ row }) => batch.attach.get(row.id));
	const toggle = (id: string, checked: boolean) => {
		const next = new Set(chosen);
		if (checked) next.add(id);
		else next.delete(id);
		onChoose(next);
	};
	return {
		all: publishableIds.length > 0 && publishableIds.every((id) => chosen.has(id)),
		attached: pdfs.filter((state) => state === "attached").length,
		/** Drafts made in the library, which take the import's DOI route. Known once the import returns, so the row never comes or goes later. */
		created: drafts.some(({ kind, row }) => kind === "created" && row.source),
		chosen,
		/** Whether the ticks can be used: some draft can go, and nothing is sending drafts on. Only a draft that can go shows one. */
		choosing: publishableIds.length > 0 && !started && !serverSending(batch),
		drafts: drafts.toSorted(byStage(batch, sentIds)),
		failedPdfs: pdfs.some((state) => state === "failed"),
		/** Drafts read from PDFs can be sent on, so the list keeps a tick's space. Fixed once the import returns. */
		offered: drafts.some(({ row }) => row.source),
		passing: publishable.filter(({ applied, row }) => rowPasses(row, applied)).length,
		pdfs: pdfs.length,
		toSend: () => publishable.filter(({ row }) => chosen.has(row.id)).map(({ itemKey, kind, row }) => ({ id: row.id, itemKey, kind })),
		/** "Publish 3", "Send 3 to the queue", then the progress. */
		label: started ? `${sent} of ${chosen.size} ${verbs.done}` : `${act.act}${chosen.size ? ` ${chosen.size}` : ""}${act.after}`,
		/** For an Editor or Owner, the other way on: to the review queue instead of published. */
		queueLabel: `Send${chosen.size ? ` ${chosen.size}` : ""} to the queue`,
		/** Drafts sent on so far, which stay out of the ticks. */
		sentIds,
		/** Whether the DOI route can still change for the drafts to come. */
		routeHeld,
		/** Whether the server still has drafts to send on; it sends them itself, so they aren't offered here. */
		serverSending: serverSending(batch),
		publishable: publishableIds,
		sent,
		verbs,
		started,
		toggle,
		toggleAll: (checked: boolean) => onChoose(new Set(checked ? publishableIds : [])),
		existing: results.filter(({ outcome }) => outcome === "skipped").length,
		failed: results.filter(({ outcome }) => outcome === "failed").length,
	};
}
