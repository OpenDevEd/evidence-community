"use client";

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, use, useState, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { TruncatedText } from "@/components/nextui/TruncatedText";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportStage } from "./ImportSteps";
import { megabytes, RemoveButton } from "./ImportInputs";
import { FILE_CHECKS } from "./admin-import";
import type { ImportFlowState } from "./import-flow";
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

/** The error to show in a footer, or the cost estimate while PDFs are chosen. */
export function InputNote({ flow }: { flow: ImportFlowState }) {
	const problem = flow.error ?? flow.footerProblem;
	if (problem) {
		return (
			<p className="min-w-0 flex-1 text-sm leading-5 text-danger [overflow-wrap:anywhere]" role="alert">
				{problem}
			</p>
		);
	}
	return null;
}

function Pages({ file }: { file: File }) {
	const count = use(pdfPageCount(file));
	return count ? <>{count} {count === 1 ? "page" : "pages"}</> : null;
}

/** A chosen PDF's page count, read in the browser; the space is held while it is counted. */
function PageCount({ file }: { file: File }) {
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

/** The checks every PDF gets from how its file was exported, under the library's checks and lined up with their text. */
export function FileChecksList() {
	return (
		<ul className="flex flex-col">
			{FILE_CHECKS.map((check) => (
				<li className="flex items-start gap-2.5 py-1 pe-1 ps-2" key={check.criterion}>
					<span aria-hidden className="w-4 shrink-0" />
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
