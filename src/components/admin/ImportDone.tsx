"use client";

import { AlertCircleIcon, CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { checkPasses, reviewChecks, rowPasses, type AttachState, type ImportBatch, type ImportRow, type PublishState } from "./admin-import";

const PER_PAGE = 8;

type Draft = { itemKey: string; row: ImportRow };

/** Where a new record stands: publishing, published with its DOI, or how its checks went. */
export function DraftState({ publish, row }: { publish: PublishState | undefined; row: ImportRow }) {
	if (publish?.state === "publishing") {
		return (
			<span className="flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
				<HugeiconsIcon aria-hidden className="animate-spin motion-reduce:animate-none" icon={Loading03Icon} size={13} />
				Publishing
			</span>
		);
	}
	if (publish?.doi) {
		// shortcut: a made-up sandbox DOI, so it isn't a link.
		return <span className="min-w-0 animate-fade-in truncate text-xs tabular-nums text-black/70 dark:text-white/70">DOI {publish.doi}</span>;
	}
	if (!row.checks.length) return <span className="text-xs text-black/45 dark:text-white/45">In Drafts</span>;
	if (rowPasses(row)) return <span className="text-xs text-emerald-700 dark:text-emerald-400">Passes every check</span>;
	const failing = reviewChecks(row).filter((check) => !checkPasses(check)).length;
	return (
		<span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
			<HugeiconsIcon aria-hidden icon={AlertCircleIcon} size={13} />
			{failing} {failing === 1 ? "check fails" : "checks fail"}
		</span>
	);
}

/**
 * The import's outcome: the counts that matter, then the new drafts. Drafts
 * read from a PDF can be published with a DOI from here; the ones that pass
 * every check start ticked, and the editor decides on the rest.
 */
/** What the finish screen knows: the new drafts, which are ticked for publishing, and how the import went. */
export function publishView(batch: ImportBatch, onChoose: (ids: ReadonlySet<string>) => void) {
	const results = batch.results ?? [];
	const rowById = new Map(batch.rows.map((row) => [row.id, row]));
	const drafts: Draft[] = results.flatMap(({ id, itemKey, outcome }) => (outcome === "created" && itemKey && rowById.has(id) ? [{ itemKey, row: rowById.get(id)! }] : []));
	const publishable = drafts.filter(({ row }) => row.file).map(({ row }) => row.id);
	const passing = drafts.filter(({ row }) => row.file && rowPasses(row)).length;
	const started = batch.publish.size > 0;
	// Once publishing starts, the ticks are the drafts it was started for.
	const chosen = started ? new Set(batch.publish.keys()) : (batch.toPublish ?? new Set(drafts.filter(({ row }) => row.file && rowPasses(row)).map(({ row }) => row.id)));
	const published = [...batch.publish.values()].filter(({ state }) => state === "published").length;
	const all = publishable.length > 0 && publishable.every((id) => chosen.has(id));
	const pdfs = [...batch.attach.values()];
	const count = (state: AttachState) => pdfs.filter((value) => value === state).length;
	const tally = [
		{ count: count("attached"), label: "PDFs attached", tone: "" },
		{ count: count("attaching"), label: "PDFs attaching", tone: "" },
		{ count: count("failed"), label: "PDFs not attached", tone: "text-amber-700 dark:text-amber-400" },
		{ count: results.filter(({ outcome }) => outcome === "skipped").length, label: "Already in the library", tone: "" },
		{ count: results.filter(({ outcome }) => outcome === "failed").length, label: "Not imported", tone: "text-danger" },
	].filter((line) => line.count > 0);
	const toggle = (id: string, checked: boolean) => {
		const next = new Set(chosen);
		if (checked) next.add(id);
		else next.delete(id);
		onChoose(next);
	};
	return {
		all,
		chosen,
		drafts,
		headline: published ? `${published} published, ${drafts.length - published} in Drafts` : `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} created`,
		passing,
		publishLabel: started ? `${published} of ${chosen.size} published` : chosen.size ? `Publish ${chosen.size} with DOIs` : "Publish with DOIs",
		publishable,
		published,
		started,
		tally,
		toggle,
		toggleAll: (checked: boolean) => onChoose(new Set(checked ? publishable : [])),
	};
}
