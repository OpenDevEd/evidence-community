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
function DraftState({ publish, row }: { publish: PublishState | undefined; row: ImportRow }) {
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
export function ImportDone({ batch, onChoose, onOpenRecord, onPublish }: { batch: ImportBatch; onChoose: (ids: ReadonlySet<string>) => void; onOpenRecord: (itemKey: string) => void; onPublish: (ids: string[]) => void }) {
	const results = batch.results ?? [];
	const rowById = new Map(batch.rows.map((row) => [row.id, row]));
	const drafts: Draft[] = results.flatMap(({ id, itemKey, outcome }) => (outcome === "created" && itemKey && rowById.has(id) ? [{ itemKey, row: rowById.get(id)! }] : []));
	const publishable = drafts.filter(({ row }) => row.file).map(({ row }) => row.id);
	const passing = drafts.filter(({ row }) => row.file && rowPasses(row)).length;
	const started = batch.publish.size > 0;
	// Once publishing starts, the ticks are the drafts it was started for.
	const chosen = started ? new Set(batch.publish.keys()) : (batch.toPublish ?? new Set(drafts.filter(({ row }) => row.file && rowPasses(row)).map(({ row }) => row.id)));
	const [page, setPage] = useState(1);
	const published = [...batch.publish.values()].filter(({ state }) => state === "published").length;
	const all = publishable.length > 0 && publishable.every((id) => chosen.has(id));
	const { current, items, pages } = pageOf(drafts, page, PER_PAGE);
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
	return (
		<div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6">
			<div className="flex items-center gap-3">
				<HugeiconsIcon aria-hidden className="animate-rise-in text-emerald-600 dark:text-emerald-400" icon={CheckmarkCircle02Icon} size={28} />
				<div>
					<h3 className="text-base font-semibold tabular-nums text-black/90 dark:text-white/90">
						{published ? `${published} published, ${drafts.length - published} in Drafts` : `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} created`}
					</h3>
					<p className="text-xs text-black/50 dark:text-white/50">
						{started ? "Each published record gets its DOI from the Zenodo sandbox. The rest stay in Drafts." : publishable.length ? `${passing} of ${publishable.length} pass every check and start ticked. Publish the ticked ones now; the rest stay in Drafts.` : "They stay in Drafts until someone publishes them."}
					</p>
				</div>
			</div>
			{tally.length ? (
				<dl className="divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
					{tally.map((line) => (
						<div className="flex h-9 items-center text-sm" key={line.label}>
							<dt className="text-black/60 dark:text-white/60">{line.label}</dt>
							<dd className={`ms-auto font-medium tabular-nums text-black/85 dark:text-white/85 ${line.tone}`}>{line.count}</dd>
						</div>
					))}
				</dl>
			) : null}
			<div>
				{publishable.length ? (
					<div className="mb-1 flex h-9 items-center gap-3 px-2">
						<Checkbox aria-label="Choose every draft to publish" isDisabled={started} isIndeterminate={chosen.size > 0 && !all} isSelected={all} onValueChange={(checked) => onChoose(new Set(checked ? publishable : []))} size="sm" />
						<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
							{chosen.size} of {publishable.length} to publish
						</span>
						<Button className="ms-auto min-w-44" color="accent" isDisabled={started || !chosen.size} onPress={() => onPublish([...chosen])} size="xs" variant="solid">
							{started ? `${published} of ${chosen.size} published` : `Publish ${chosen.size} with DOIs`}
						</Button>
					</div>
				) : null}
				<ul className="flex flex-col">
					{items.map(({ itemKey, row }) => (
						<li className="flex h-12 items-center gap-3 rounded-lg px-2 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" key={row.id}>
							{publishable.length ? (
								<Checkbox aria-label={`Publish ${row.record?.title ?? row.record?.source}`} isDisabled={started || !row.file} isSelected={chosen.has(row.id)} onValueChange={(checked) => toggle(row.id, checked)} size="sm" />
							) : null}
							<ImportCover className="w-7" file={row.file} itemType={row.record?.itemType} size={12} />
							<span className="min-w-0 flex-1 truncate text-sm text-black/85 dark:text-white/85">{row.record?.title ?? row.record?.source}</span>
							<span className="flex w-44 shrink-0 justify-end">
								<DraftState publish={batch.publish.get(row.id)} row={row} />
							</span>
							<Button onPress={() => onOpenRecord(itemKey)} size="xs" variant="transparent">
								Open
							</Button>
						</li>
					))}
				</ul>
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={PER_PAGE} total={drafts.length} />
			</div>
		</div>
	);
}
