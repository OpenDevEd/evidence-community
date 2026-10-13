"use client";

import { AlertCircleIcon, Loading03Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";

import { publicationPresentation } from "./AdminPublicationStatus";
import { checkPasses, reviewChecks, rowPasses, type AttachState, type ImportBatch, type ImportRow, type PublishState } from "./admin-import";
import { useAdminPublication } from "./useAdminPublication";

type Draft = { itemKey: string; kind: "created" | "imported" | undefined; row: ImportRow };

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

/** Where a new draft stands: publishing, its DOI once published, or how its checks went. */
export function DraftState({ attach, draft, publish }: { attach: AttachState | undefined; draft: Draft; publish: PublishState | undefined }) {
	const { row } = draft;
	if (publish?.state === "publishing") {
		return (
			<span className={`${note} text-black/50 dark:text-white/50`}>
				<HugeiconsIcon aria-hidden className="animate-spin motion-reduce:animate-none" icon={Loading03Icon} size={13} />
				Publishing
			</span>
		);
	}
	if (publish?.state === "published") return <PublishedDoi itemKey={draft.itemKey} />;
	if (publish?.state === "failed" || attach === "failed") {
		return (
			<span className={`${note} text-danger`}>
				<HugeiconsIcon aria-hidden className="shrink-0" icon={AlertCircleIcon} size={13} />
				{/* One line, as every other state, so a failure doesn't make the row taller. */}
				<TruncatedText className="min-w-0" focusable text={publish?.message ?? "The PDF didn't attach, so it stays a draft"} />
			</span>
		);
	}
	if (!row.checks.length) return <span className="text-xs text-black/45 dark:text-white/45">In Drafts</span>;
	if (rowPasses(row)) return <span className="text-xs text-emerald-700 dark:text-emerald-400">Passes every check</span>;
	const failing = reviewChecks(row).filter((check) => !checkPasses(check)).length;
	return (
		<span className={`${note} text-amber-700 dark:text-amber-400`}>
			<HugeiconsIcon aria-hidden icon={AlertCircleIcon} size={13} />
			{failing} {failing === 1 ? "check fails" : "checks fail"}
		</span>
	);
}

/**
 * What the finish screen knows: the new drafts, which are ticked for
 * publishing, and how the import went. Only editors and owners publish, as
 * anywhere in the admin; a creator's import ends with the drafts. Drafts
 * read from a PDF are publishable once their PDF is attached; the ones that
 * pass every check start ticked, and the editor decides on the rest.
 */
export function publishView(batch: ImportBatch, onChoose: (ids: ReadonlySet<string>) => void, canPublish: boolean) {
	const results = batch.results ?? [];
	const rowById = new Map(batch.rows.map((row) => [row.id, row]));
	const drafts: Draft[] = results.flatMap(({ id, itemKey, kind, outcome }) => (outcome === "created" && itemKey && rowById.has(id) ? [{ itemKey, kind, row: rowById.get(id)! }] : []));
	const publishable = canPublish ? drafts.filter(({ row }) => row.file && batch.attach.get(row.id) !== "failed") : [];
	const publishableIds = publishable.map(({ row }) => row.id);
	const started = batch.publish.size > 0;
	// Once publishing starts, the ticks are the drafts it was started for. Before
	// that, a ticked draft whose PDF then fails to attach drops out.
	const chosen = started ? new Set(batch.publish.keys()) : new Set((batch.toPublish ? [...batch.toPublish] : publishable.filter(({ row }) => rowPasses(row)).map(({ row }) => row.id)).filter((id) => publishableIds.includes(id)));
	const published = [...batch.publish.values()].filter(({ state }) => state === "published").length;
	const pdfs = drafts.filter(({ row }) => row.file).map(({ row }) => batch.attach.get(row.id));
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
		created: canPublish && drafts.some(({ kind, row }) => kind === "created" && row.file),
		chosen,
		drafts,
		failedPdfs: pdfs.some((state) => state === "failed"),
		/** Publishing is offered: an editor or owner, and drafts read from PDFs. Fixed once the import returns, so the ticks and the button don't come and go as PDFs attach. */
		offered: canPublish && drafts.some(({ row }) => row.file),
		passing: publishable.filter(({ row }) => rowPasses(row)).length,
		pdfs: pdfs.length,
		publish: () => publishable.filter(({ row }) => chosen.has(row.id)).map(({ itemKey, kind, row }) => ({ id: row.id, itemKey, kind })),
		publishLabel: started ? `${published} of ${chosen.size} published` : chosen.size ? `Publish ${chosen.size}` : "Publish",
		publishable: publishableIds,
		published,
		started,
		toggle,
		toggleAll: (checked: boolean) => onChoose(new Set(checked ? publishableIds : [])),
		/** A chosen draft's PDF is still uploading, and a record is submitted with its files. */
		waiting: [...chosen].some((id) => batch.attach.get(id) === "attaching"),
		existing: results.filter(({ outcome }) => outcome === "skipped").length,
		failed: results.filter(({ outcome }) => outcome === "failed").length,
	};
}
