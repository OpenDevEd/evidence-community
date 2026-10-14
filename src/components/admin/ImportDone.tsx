"use client";

import { AlertCircleIcon, InboxIcon, Loading03Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";

import { publicationPresentation } from "./AdminPublicationStatus";
import { appliedOf, checkPasses, reviewChecks, rowPasses, type AttachState, type ImportBatch, type ImportRow, type PublishState } from "./admin-import";
import { useAdminPublication } from "./useAdminPublication";

type Draft = { applied: ReadonlySet<number>; itemKey: string; kind: "created" | "imported" | undefined; row: ImportRow };

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

/** Where a new draft stands: on its way, published with its DOI, waiting for an editor, or how its checks went. */
export function DraftState({ attach, draft, publish, verbs }: { attach: AttachState | undefined; draft: Draft; publish: PublishState | undefined; verbs: SendVerbs }) {
	if (publish) return <SentState itemKey={draft.itemKey} publish={publish} verbs={verbs} />;
	if (attach === "failed") return <FailedNote text="The PDF didn't attach, so it stays a draft" />;
	return <ChecksState draft={draft} />;
}

/** A draft sent on from the finish step: on its way, published, waiting for an editor, or failed. */
function SentState({ itemKey, publish, verbs }: { itemKey: string; publish: PublishState; verbs: SendVerbs }) {
	if (publish.state === "published") return <PublishedDoi itemKey={itemKey} />;
	if (publish.state === "failed") return <FailedNote text={publish.message ?? "The PDF didn't attach, so it stays a draft"} />;
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

function FailedNote({ text }: { text: string }) {
	return (
		<span className={`${note} text-danger`}>
			<HugeiconsIcon aria-hidden className="shrink-0" icon={AlertCircleIcon} size={13} />
			{/* One line, as every other state, so a failure doesn't make the row taller. */}
			<TruncatedText className="min-w-0" focusable text={text} />
		</span>
	);
}

/** A draft not sent on: how its PDF's checks went. */
function ChecksState({ draft: { applied, row } }: { draft: Draft }) {
	if (!row.checks.length) return <span className="text-xs text-black/45 dark:text-white/45">In Drafts</span>;
	if (rowPasses(row, applied)) return <span className="text-xs text-emerald-700 dark:text-emerald-400">Passes every check</span>;
	const failing = reviewChecks(row, applied).filter((check) => !checkPasses(check)).length;
	return (
		<span className={`${note} text-amber-700 dark:text-amber-400`}>
			<HugeiconsIcon aria-hidden icon={AlertCircleIcon} size={13} />
			{failing} {failing === 1 ? "check fails" : "checks fail"}
		</span>
	);
}

/**
 * The finish step's words for the role, as anywhere in the admin: editors
 * and owners publish (submit and approve at once), and everyone else
 * submits for an editor to approve.
 */
function sendVerbs(canPublish: boolean) {
	return canPublish
		? { act: "Publish", after: "", doing: "Publishing", done: "published", to: "to publish" }
		: { act: "Submit", after: " for review", doing: "Submitting", done: "submitted", to: "to submit" };
}

type SendVerbs = ReturnType<typeof sendVerbs>;

/**
 * Where sending stands: the drafts already published or submitted, and
 * whether a run holds the ticks, which it does while it sends and once it
 * sent every draft. A run that left failures lets the failed ones be sent again.
 */
function sending(batch: ImportBatch) {
	const states = [...batch.publish.values()].map(({ state }) => state);
	const sentIds = new Set([...batch.publish].filter(([, { state }]) => state === "published" || state === "submitted").map(([id]) => id));
	return { sentIds, started: states.length > 0 && (states.includes("sending") || !states.includes("failed")) };
}

/**
 * What the finish screen knows: the new drafts, which are ticked to publish
 * or submit, and how the import went. Drafts read from a PDF can go once
 * their PDF is attached; the ones that pass every check start ticked, and
 * the person importing decides on the rest.
 */
export function publishView(batch: ImportBatch, onChoose: (ids: ReadonlySet<string>) => void, canPublish: boolean) {
	const results = batch.results ?? [];
	const rowById = new Map(batch.rows.map((row) => [row.id, row]));
	const drafts: Draft[] = results.flatMap(({ id, itemKey, kind, outcome }) => (outcome === "created" && itemKey && rowById.has(id) ? [{ applied: appliedOf(batch, rowById.get(id)!), itemKey, kind, row: rowById.get(id)! }] : []));
	const verbs = sendVerbs(canPublish);
	const { sentIds, started } = sending(batch);
	// A draft goes on with its PDF, so only one whose PDF is attached can, and one already sent can't go again.
	const publishable = drafts.filter(({ row }) => row.source && batch.attach.get(row.id) === "attached" && !sentIds.has(row.id));
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
		drafts,
		failedPdfs: pdfs.some((state) => state === "failed"),
		/** Drafts read from PDFs can be sent on. Fixed once the import returns, so the ticks and the button don't come and go as PDFs attach. */
		offered: drafts.some(({ row }) => row.source),
		passing: publishable.filter(({ applied, row }) => rowPasses(row, applied)).length,
		pdfs: pdfs.length,
		toSend: () => publishable.filter(({ row }) => chosen.has(row.id)).map(({ itemKey, kind, row }) => ({ id: row.id, itemKey, kind })),
		/** "Publish 3", "Submit 3 for review", then the progress. */
		label: started ? `${sent} of ${chosen.size} ${verbs.done}` : `${verbs.act}${chosen.size ? ` ${chosen.size}` : ""}${verbs.after}`,
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
