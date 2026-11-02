"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ListItem } from "@/app/api/item/types";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded, More } from "./client";
import { CHECKED, FLAG, KINDS, levelOf, whoOf, yearOf, type Label } from "./data";
import type { Selection } from "./graph";
import { muted, PANEL, PaperRow, Section, VerdictMeter, type OnHover } from "./lists";
import { css, edgeColour } from "./palette";
import { lineOf, useLines, usePaper } from "./records";
import { VerdictChip } from "./verdict-chip";
import { KIND_LABEL } from "./verdicts";

type Opened = { selection: Selection; loaded: Loaded; more: More; onOpen: (index: number) => void; onHover: OnHover };

const DIVIDER = "border-t border-black/[0.06] dark:border-white/[0.08]";

/** Back to the list the paper was opened from, named, at the head of the panel the paper took over. */
export function BackButton({ to, onBack }: { to: string; onBack: () => void }) {
	return (
		<button type="button" onClick={onBack} className="-ml-2 inline-flex h-8 items-center gap-1 rounded-lg pl-2 pr-2.5 text-sm font-semibold text-accent outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent dark:text-white dark:hover:bg-white/10">
			<HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden />
			{to}
		</button>
	);
}

/** A heading over lists, scrolling with them as one. */
function Scrolling({ heading, lists }: { heading: ReactNode; lists: ReactNode }) {
	return <div className="min-h-0 flex-1 overflow-y-auto pb-3">{heading}<div className={DIVIDER}>{lists}</div></div>;
}

/** Who, when and where, or, for a library record the search did not return, that it couldn't be loaded. */
function Byline({ record, label, missing }: { record: ListItem | null | undefined; label: Label | undefined; missing: boolean }) {
	const t = useTranslations("evidenceMap");
	// Said, so a broken connection never looks like an empty paper.
	if (missing) return <p role="status" className="mt-1 text-sm text-danger">{t("thisRecordCouldnTBeLoaded")}ment.</p>;
	const parts = [whoOf(record) ?? label?.who, yearOf(record) ?? label?.year, record?.publicationTitle];
	return <p className={twMerge("mt-1 min-h-4 text-xs", muted)}>{parts.filter(Boolean).join(", ")}</p>;
}

/** Where the paper is read: its record in this library, or its DOI. */
function PaperLink({ itemKey, doi }: { itemKey: string | null; doi: string | undefined }) {
	const t = useTranslations("evidenceMap");
	if (itemKey) return <Link href={`/lib/${itemKey}`} className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">{t("openRecord")}<HugeiconsIcon icon={ArrowUpRight01Icon} size={14} /></Link>;
	if (doi) return <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-black/[0.06] px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/10">{t("openDoi")}<HugeiconsIcon icon={ArrowUpRight01Icon} size={14} /></a>;
	return null;
}

/** The opened paper's heading: what it is, its check, its title, who wrote it, and where to read it. */
function PaperHeading({ index, record, loaded, more, onClose, back }: { index: number; record: ListItem | null | undefined; loaded: Loaded; more: More; onClose: () => void; back: string }) {
	const t = useTranslations("evidenceMap");
	const key = more.keyOf(index), label = more.labels.get(index);
	// A library record the search no longer returns (unpublished, hidden, or the search unreachable): no link to a page that fails.
	const missing = Boolean(key && record === null);
	const kindKey = KIND_LABEL[KINDS[loaded.points.kind[index]]];
	const kind = kindKey ? t(kindKey) : null;
	return (
		<>
			<div className="px-5 pt-3"><BackButton to={back} onBack={onClose} /></div>
			<div className="flex flex-wrap items-center gap-2 px-5 pt-2">
				{kind && <span className="rounded-lg bg-black/[0.05] px-2 py-1 text-xs font-semibold dark:bg-white/10">{kind}</span>}
				<VerdictChip verdict={loaded.points.verdict[index]} />
			</div>
			<div className="px-5 pb-3 pt-3">
				<h2 className="text-base font-semibold leading-snug">{record?.title || label?.title || " "}</h2>
				<Byline record={record} label={label} missing={missing} />
				<div className="mt-3 flex flex-wrap gap-2"><PaperLink itemKey={missing ? null : key} doi={more.doiOf.get(index)} /></div>
			</div>
		</>
	);
}

/** The opened paper: its heading, then its chain or its citations. */
function PaperBody({ selection, record, loaded, more, onOpen, onClose, onHover, back }: Opened & { record: ListItem | null | undefined; onClose: () => void; back: string }) {
	if (selection.index === CHECKED) return <CheckedBody selection={selection} loaded={loaded} more={more} onOpen={onOpen} onClose={onClose} onHover={onHover} back={back} />;
	const opened = { selection, loaded, more, onOpen, onHover };
	return <Scrolling heading={<PaperHeading index={selection.index} record={record} loaded={loaded} more={more} onClose={onClose} back={back} />} lists={selection.chain ? <ChainDetail {...opened} /> : <Around {...opened} />} />;
}

/** The class a kept paper wears while the next one opens. */
const STALE = "pointer-events-none opacity-50 transition-opacity";

/** The paper the panel or sheet shows, dimmed and out of reach while the next one opens. */
export function OpenedPaper({ shown, stale, loaded, more, onOpen, onClose, onHover, back }: { shown: { selection: Selection; record: ListItem | null | undefined }; stale: boolean; loaded: Loaded; more: More; onOpen: (index: number) => void; onClose: () => void; onHover: OnHover; back: string }) {
	return (
		<div aria-busy={stale || undefined} inert={stale} className={twMerge("flex min-h-0 flex-1 flex-col", stale && STALE)}>
			<PaperBody selection={shown.selection} record={shown.record} loaded={loaded} more={more} onOpen={onOpen} onClose={onClose} onHover={onHover} back={back} />
		</div>
	);
}

const LEVEL_NAME = { 1: "levels.1", 2: "levels.2", 3: "levels.3" } as const;
const LINE_KEY = [
	{ verdict: "broken", label: "lineKey.broken" },
	{ verdict: "validated", label: "lineKey.validated" },
	{ verdict: "notAssessed", label: "lineKey.notAssessed" },
] as const;

/** Checked papers drawn on the map, by level: a methods reference or a paper joined to nothing on it has no place there. */
function checkedByLevel(loaded: Loaded) {
	const byLevel = new Map<number, number>(), { verdict, flags, kind } = loaded.points;
	verdict.forEach((v, i) => {
		if (!v || flags[i] & (FLAG.methods | FLAG.stray)) return;
		const level = levelOf(kind[i]);
		byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
	});
	return byLevel;
}

function CheckedHeading({ onClose, back }: { onClose: () => void; back: string }) {
	const t = useTranslations("evidenceMap");
	return (
		<div className="px-5 pb-3 pt-3">
			<BackButton to={back} onBack={onClose} />
			<h2 className="pt-2 text-base font-semibold leading-snug">{t("appraisedPapers")}</h2>
			<p className={twMerge("mt-1 text-xs", muted)}>{t("everyCheckedPaperJoinedToAnother")}</p>
			<ul className="mt-3 space-y-1.5 text-xs">
				{LINE_KEY.map(({ verdict, label }) => (
					<li key={verdict} className="flex items-center gap-2">
						<svg width="22" height="6" aria-hidden className="shrink-0"><line x1="1" y1="3" x2="21" y2="3" stroke={css(edgeColour(verdict, 1))} strokeWidth="2" strokeDasharray={verdict === "broken" ? "5 3" : undefined} /></svg>
						{label}
					</li>
				))}
			</ul>
		</div>
	);
}

/** The whole graph of checked papers: its three columns, what the line colours mean, and every paper in it. */
function CheckedBody({ selection, loaded, more, onOpen, onClose, onHover, back }: Opened & { onClose: () => void; back: string }) {
	const t = useTranslations("evidenceMap");
	const layers = selection.chain?.layers ?? [];
	const members = layers.flat();
	const records = useLines(members, more);
	const checkedAt = checkedByLevel(loaded);
	const row = (i: number) => <PaperRow key={i} index={i} label={lineOf(i, more, records)} loaded={loaded} onOpen={onOpen} onHover={onHover} />;
	const column = (layer: number[]) => {
		const level = levelOf(loaded.points.kind[layer[0]]) as 1 | 2 | 3;
		const joined = layer.filter((i) => loaded.points.verdict[i]).length;
		return (
			<Section key={level} title={t(LEVEL_NAME[level])} count={layer.length}>
				<p className={twMerge("px-5 pb-1 text-xs", muted)}>{layer.length - joined ? t("joinedUnchecked", { joined, checked: checkedAt.get(level) ?? 0, unchecked: layer.length - joined }) : t("joined", { joined, checked: checkedAt.get(level) ?? 0 })}</p>
				<ol className="px-2">{layer.map(row)}</ol>
			</Section>
		);
	};
	const lists = (
		<>
			<div className="px-5 pt-3"><VerdictMeter indices={members.filter((i) => loaded.points.verdict[i])} loaded={loaded} /></div>
			{layers.map(column)}
		</>
	);
	return <Scrolling heading={<CheckedHeading onClose={onClose} back={back} />} lists={lists} />;
}

/** A paper's chain as lists: the studies it analyses with their checks, what those analyse, and what analyses it. */
function ChainDetail({ selection, loaded, more, onOpen, onHover }: Opened) {
	const t = useTranslations("evidenceMap");
	const chain = selection.chain!;
	const at = chain.layers.findIndex((layer) => layer[0] === chain.focus);
	// Columns from the left: what its studies analysed, its studies, the paper, what analyses it, what analyses those.
	const below = chain.layers.slice(0, at).reverse(), above = chain.layers.slice(at + 1);
	const analysed = below[0] ?? [];
	const records = useLines(chain.layers.flat(), more);
	const list = (indices: number[]) => <ol className="px-2">{indices.map((i) => <PaperRow key={i} index={i} label={lineOf(i, more, records)} loaded={loaded} onOpen={onOpen} onHover={onHover} />)}</ol>;
	const sections: [string, number[] | undefined, number][] = [[t("sections.analyses"), below[0], Infinity], [t("sections.thoseAnalyse"), below[1], 30], [t("sections.analysedBy"), above[0], Infinity], [t("sections.reviews"), above[1], Infinity]];
	return (
		<>
			{analysed.length > 0 && <div className="px-5 pt-3"><VerdictMeter indices={analysed} loaded={loaded} /></div>}
			{sections.map(([title, indices, most]) => (indices?.length ? <Section key={title} title={title} count={indices.length}>{list(indices.slice(0, most))}</Section> : null))}
		</>
	);
}

/** A paper's citations in the library, both ways, the most cited first. */
function Around({ selection, loaded, more, onOpen, onHover }: Opened) {
	const t = useTranslations("evidenceMap");
	const top = (list: number[]) => [...list].sort((a, b) => loaded.points.cites[b] - loaded.points.cites[a]).slice(0, 8);
	const records = useLines([...top(selection.citedBy), ...top(selection.cites)], more);
	if (!selection.cites.length && !selection.citedBy.length) return <p className={twMerge("px-5 pt-3 text-sm", muted)}>{t("noCitationsToOrFromOther")}</p>;
	const section = (title: string, list: number[]) => (list.length ? <Section title={title} count={list.length}><ol className="px-2">{top(list).map((i) => <PaperRow key={i} index={i} label={lineOf(i, more, records)} loaded={loaded} onOpen={onOpen} onHover={onHover} />)}</ol></Section> : null);
	return (
		<>
			{section(t("citedByInLibrary"), selection.citedBy)}
			{section(t("citesInLibrary"), selection.cites)}
		</>
	);
}
