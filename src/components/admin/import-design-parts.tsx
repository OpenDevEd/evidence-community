"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, LockIcon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, use, useState, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { TruncatedText } from "@/components/nextui/TruncatedText";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { ImportSteps, type ImportKind, type ImportStage } from "./ImportSteps";
import { megabytes, RemoveButton } from "./ImportInputs";
import { FILE_CHECKS } from "./admin-import";
import { CostEstimate, DesignSwitch, type ImportFlowState } from "./import-flow";
import { pdfPageCount } from "./pdf-thumbnail";

/** The stage's content, faded in when the stage changes. */
export function StageFade({ children, className = "flex min-h-0 flex-1 flex-col", stage }: { children: ReactNode; className?: string; stage: ImportStage }) {
	const reduceMotion = useReducedMotion();
	return (
		<AnimatePresence initial={false} mode="wait">
			<motion.div animate={{ opacity: 1 }} className={className} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={stage} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}

/** The title, where the import is, the mock's design switch, and anything the design adds on the right. */
export function DesignHeader({ children, lead, stage }: { children?: ReactNode; lead?: ReactNode; stage: ImportStage }) {
	return (
		<header className="flex h-14 shrink-0 items-center gap-4 border-b border-black/[0.06] px-6 dark:border-white/[0.06]">
			{lead}
			<h2 className="text-base font-semibold text-black/90 dark:text-white/90">Import records</h2>
			<ImportSteps stage={stage} />
			<span className="ms-auto flex items-center gap-3">
				<DesignSwitch />
				{children}
			</span>
		</header>
	);
}

/** PDFs, DOIs or bibliography files, in the product's tabs. */
export function SourceTabs({ className = "", dois, files, flow, pdfs, panel = "px-0 pb-0 pt-5" }: { className?: string; dois: ReactNode; files: ReactNode; flow: ImportFlowState; pdfs: ReactNode; panel?: string }) {
	return (
		<Tabs aria-label="Import from" className={className} classNames={{ panel }} isDisabled={flow.busy} onSelectionChange={(key) => flow.setKind(key as ImportKind)} selectedKey={flow.kind}>
			<Tab key="pdfs" title="PDFs">
				{pdfs}
			</Tab>
			<Tab key="dois" title="DOIs">
				{dois}
			</Tab>
			<Tab key="files" title="Bibliography files">
				{files}
			</Tab>
		</Tabs>
	);
}

/** The error to show in a footer, or the cost estimate while PDFs are chosen. */
export function InputNote({ flow }: { flow: ImportFlowState }) {
	const problem = flow.error ?? flow.footerProblem;
	if (problem) {
		return (
			<p className="min-w-0 flex-1 truncate text-sm text-danger" role="alert">
				{problem}
			</p>
		);
	}
	if (flow.stage === "input" && flow.kind === "pdfs" && flow.estimateFiles.length) {
		return (
			<Suspense fallback={null}>
				<CostEstimate files={flow.estimateFiles} stale={flow.estimateFiles !== flow.pdfs} />
			</Suspense>
		);
	}
	return null;
}

export function ErrorNote({ flow }: { flow: ImportFlowState }) {
	return flow.error ? (
		<p className="min-w-0 flex-1 truncate text-sm text-danger" role="alert">
			{flow.error}
		</p>
	) : null;
}

/** A keyboard key, shown beside the control it presses. */
export function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-black/10 px-1 font-sans text-[11px] text-black/50 dark:border-white/15 dark:text-white/50">{children}</kbd>;
}

function Pages({ file }: { file: File }) {
	const count = use(pdfPageCount(file));
	return count ? <>{count} {count === 1 ? "page" : "pages"}</> : null;
}

/** A chosen PDF's page count, read in the browser; the space is held while it is counted. */
export function PageCount({ file }: { file: File }) {
	return (
		<span className="inline-block min-w-[4.5rem] text-xs tabular-nums text-black/45 dark:text-white/45">
			<Suspense fallback={null}>
				<Pages file={file} />
			</Suspense>
		</span>
	);
}

/** The chosen PDFs as compact rows with their pages and size, a page at a time. */
export function PdfRows({ busy, files, onFilesChange, perPage = 6 }: { busy: boolean; files: File[]; onFilesChange: (files: File[]) => void; perPage?: number }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(files, page, perPage);
	return (
		<div>
			<ul className="flex flex-col">
				{items.map((file) => (
					<li className="flex h-12 items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={`${file.name}:${file.size}`}>
						<ImportCover className="w-7" file={file} size={12} />
						<span className="min-w-0 flex-1 text-sm text-black/80 dark:text-white/80">
							<TruncatedText text={file.name} />
						</span>
						<PageCount file={file} />
						<span className="w-14 text-end text-xs tabular-nums text-black/45 dark:text-white/45">{megabytes(file.size)}</span>
						<RemoveButton busy={busy} name={file.name} onPress={() => onFilesChange(files.filter((other) => other !== file))} />
					</li>
				))}
			</ul>
			<ImportPager label="Pages of chosen PDFs" onChange={setPage} page={current} pages={pages} perPage={perPage} total={files.length} />
		</div>
	);
}

/** The checks every PDF gets from its own file, shown where the library's checks are edited. */
export function FileChecksList() {
	return (
		<ul className="flex flex-col">
			{FILE_CHECKS.map((check) => (
				<li className="flex items-start gap-2.5 py-1 pe-1 ps-2" key={check.criterion}>
					<HugeiconsIcon aria-label="Always checked" className="mt-1.5 w-4 shrink-0 text-black/30 dark:text-white/30" icon={LockIcon} size={12} />
					<span className="py-1 text-sm leading-5 text-black/55 dark:text-white/55">{check.criterion}</span>
				</li>
			))}
		</ul>
	);
}

/** Previous and next for a narrow list, with the range shown. */
export function NarrowPager({ onChange, page, pages, perPage, total }: { onChange: (page: number) => void; page: number; pages: number; perPage: number; total: number }) {
	if (pages < 2) return null;
	return (
		<div className="flex items-center gap-1 pt-2">
			<span className="me-auto text-xs tabular-nums text-black/50 dark:text-white/50">
				{(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total}
			</span>
			<Button aria-label="Previous page" className="size-7 min-w-7" isDisabled={page <= 1} isIconOnly onPress={() => onChange(page - 1)} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={14} />
			</Button>
			<Button aria-label="Next page" className="size-7 min-w-7" isDisabled={page >= pages} isIconOnly onPress={() => onChange(page + 1)} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={14} />
			</Button>
		</div>
	);
}

/** A tally label inside a sentence: "Already in the library" becomes "already in the library", "PDFs not attached" stays. */
export const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label);
