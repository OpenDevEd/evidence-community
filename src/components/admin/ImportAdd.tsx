"use client";

import { AlertCircleIcon, ArrowDown01Icon, Book02Icon, CheckListIcon, Folder01Icon, Link01Icon, NoteEditIcon, Pdf01Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import { ADMIN_IMPORT_FILE_EXTENSIONS, ADMIN_IMPORT_FILE_FORMATS, ADMIN_IMPORT_MAX_FILES, ADMIN_IMPORT_MAX_RECORDS, PDF_IMPORT_MAX_GUIDANCE_LENGTH, parseDoiList } from "@/lib/admin/item-import-contract";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import { ChecksEditor, DropArea, megabytes, PDF_ACCEPT, RemoveButton, withNew } from "./ImportInputs";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportKind } from "./ImportSteps";
import { adminPanelTabState } from "./admin-tab-styles";
import { FILE_CHECKS, PDF_IMPORT_MAX_FILES } from "./admin-import";
import { FileChecksList, PdfRows } from "./import-parts";
import type { ImportFlowState } from "./import-flow";

const SOURCES: { icon: typeof Pdf01Icon; kind: ImportKind; label: string }[] = [
	{ icon: Pdf01Icon, kind: "pdfs", label: "PDFs" },
	{ icon: Link01Icon, kind: "dois", label: "DOIs" },
	{ icon: Book02Icon, kind: "files", label: "Bibliography files" },
];

/** What to import from, in the admin's panel tabs: the chosen one joins the sheet below it. */
export function SourceTabs({ flow }: { flow: ImportFlowState }) {
	const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = SOURCES[(index + step + SOURCES.length) % SOURCES.length]!;
		flow.setKind(next.kind);
		document.getElementById(`import-source-${next.kind}`)?.focus();
	};
	return (
		<div aria-label="Import from" className="flex shrink-0 px-3" role="tablist">
			{SOURCES.map((source, index) => {
				const selected = flow.kind === source.kind;
				return (
					<button
						aria-controls="import-source-panel"
						aria-selected={selected}
						className={`flex min-h-11 flex-auto items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium outline-none transition-background-text focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed ${adminPanelTabState(selected)}`}
						disabled={flow.busy}
						id={`import-source-${source.kind}`}
						key={source.kind}
						onClick={() => flow.setKind(source.kind)}
						onKeyDown={(event) => move(event, index)}
						role="tab"
						tabIndex={selected ? 0 : -1}
						type="button"
					>
						<HugeiconsIcon aria-hidden className="shrink-0" icon={source.icon} size={18} strokeWidth={1.8} />
						{source.label}
					</button>
				);
			})}
		</div>
	);
}

/** One setting in the group at the top: what it holds now, and the editor when it opens. */
function Setting({ children, icon, summary, title }: { children: ReactNode; icon: typeof Pdf01Icon; summary: string; title: string }) {
	const reduceMotion = useReducedMotion();
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button aria-expanded={open} className="flex h-12 w-full items-center gap-3 px-4 text-start outline-none transition-colors duration-150 hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/[0.03]" onClick={() => setOpen(!open)} type="button">
				<HugeiconsIcon aria-hidden className="shrink-0 text-black/45 dark:text-white/45" icon={icon} size={17} />
				<span className="shrink-0 text-sm font-medium text-black/85 dark:text-white/85">{title}</span>
				<span className="min-w-0 flex-1 truncate text-end text-xs text-black/45 dark:text-white/45">{summary}</span>
				<HugeiconsIcon aria-hidden className={`shrink-0 text-black/35 transition-transform duration-200 dark:text-white/35 ${open ? "rotate-180" : ""}`} icon={ArrowDown01Icon} size={15} />
			</button>
			<AnimatePresence initial={false}>
				{open ? (
					<motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.32, 0.72, 0, 1] }}>
						<div className="px-4 pb-4 pt-1">{children}</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

const GUIDANCE_EXAMPLE = ["Write in British English.", "Don't copy the PDF's abstract. Write three sentences for a policy reader instead.", "Give the organisation's full name as the author, not its acronym."].join("\n");

/** Free text the AI follows when it reads every PDF: language, how to write the abstract, anything the checks don't cover. */
function GuidanceEditor({ flow }: { flow: ImportFlowState }) {
	const length = flow.guidance.trim().length;
	return (
		<div>
			<p className="mb-3 text-xs leading-5 text-black/50 dark:text-white/50">Saved for this library and sent to the AI with every PDF. Where it conflicts with how the AI works by default, the guidance wins, but it never makes the AI invent facts.</p>
			<Textarea aria-label="Guidance for the AI" classNames={{ input: "text-sm leading-6" }} isDisabled={flow.busy} maxLength={PDF_IMPORT_MAX_GUIDANCE_LENGTH} maxRows={14} minRows={5} onValueChange={flow.setGuidance} placeholder={GUIDANCE_EXAMPLE} value={flow.guidance} />
			<p className={`mt-1.5 h-4 text-end text-xs tabular-nums transition-opacity duration-200 ${length > PDF_IMPORT_MAX_GUIDANCE_LENGTH * 0.8 ? "text-black/50 dark:text-white/50" : "opacity-0"}`}>
				{length} of {PDF_IMPORT_MAX_GUIDANCE_LENGTH}
			</p>
		</div>
	);
}

/** The settings an editor keeps changing, at the top: what the AI checks and follows for PDFs, and where the drafts go. */
function Settings({ flow }: { flow: ImportFlowState }) {
	const guidance = flow.guidance.trim();
	return (
		<div className="shrink-0 divide-y divide-black/[0.05] overflow-hidden rounded-xl bg-black/[0.025] dark:divide-white/[0.06] dark:bg-white/[0.035]">
			{flow.kind === "pdfs" ? (
				<>
					<Setting icon={CheckListIcon} summary={`${flow.checks.length} for this library, ${FILE_CHECKS.length} for every PDF`} title="Checks">
						<ChecksEditor busy={flow.busy} criteria={flow.checks} onChange={flow.setChecks} />
						<p className="mb-1 mt-4 text-xs text-black/45 dark:text-white/45">Also checked in every PDF, from how the file was exported</p>
						<FileChecksList />
					</Setting>
					<Setting icon={NoteEditIcon} summary={guidance ? guidance.split("\n")[0]! : "None yet"} title="Guidance">
						<GuidanceEditor flow={flow} />
					</Setting>
				</>
			) : null}
			<Setting icon={Folder01Icon} summary={flow.collections.length ? `${flow.collections.length} chosen` : "None"} title="Collections">
				<p className="mb-3 text-xs leading-5 text-black/50 dark:text-white/50">The new drafts go into these.</p>
				<AdminCollectionPicker
					allowedSourceKeys={editableItemCollectionSourceKeysForItems([NATIVE_SOURCE_CONNECTION_KEY], flow.sources)}
					onSelectionChange={flow.setCollections}
					selectedKeys={flow.collections}
					selectionMode="multiple"
					sources={flow.sources}
				/>
			</Setting>
		</div>
	);
}

/** What was added so far, its size, and a way to start again. */
function UploadHeader({ aside, busy, onClear, title }: { aside?: string; busy: boolean; onClear?: () => void; title: string }) {
	return (
		<div className="flex h-8 shrink-0 items-center gap-3">
			<h3 className="whitespace-nowrap text-sm font-medium text-black/85 dark:text-white/85">{title}</h3>
			{aside ? <span className="min-w-0 truncate text-xs tabular-nums text-black/45 dark:text-white/45">{aside}</span> : null}
			{onClear ? (
				<Button className="ms-auto h-7 min-h-7" isDisabled={busy} onPress={onClear} size="xs" variant="transparent">
					Clear all
				</Button>
			) : null}
		</div>
	);
}

/** The drop target that fills what is left of the sheet, so there is always room to add more. */
function Dropzone({ accept, busy, hint, label, onFiles, what }: { accept: string; busy: boolean; hint: string; label: string; onFiles: (files: File[]) => void; what: string }) {
	return (
		<DropArea accept={accept} busy={busy} className="min-h-32 flex-1 gap-1.5 px-6" label={label} onFiles={onFiles}>
			<HugeiconsIcon aria-hidden className="mb-1 text-black/35 dark:text-white/35" icon={Upload04Icon} size={22} />
			<span className="text-sm text-black/75 dark:text-white/75">
				Drop {what} here, or <span className="font-medium text-accent">browse</span>
			</span>
			<span className="text-xs text-black/45 dark:text-white/45">{hint}</span>
		</DropArea>
	);
}

const totalSize = (files: readonly File[]) => megabytes(files.reduce((sum, file) => sum + file.size, 0));

function PdfUpload({ flow }: { flow: ImportFlowState }) {
	const count = flow.pdfs.length;
	return (
		<>
			{count ? (
				<>
					<UploadHeader aside={totalSize(flow.pdfs)} busy={flow.busy} onClear={() => flow.setPdfs([])} title={`${count} ${count === 1 ? "PDF" : "PDFs"}`} />
					<PdfRows busy={flow.busy} files={flow.pdfs} onFilesChange={flow.setPdfs} perPage={8} />
				</>
			) : null}
			<Dropzone accept={PDF_ACCEPT} busy={flow.busy} hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each. Claude Haiku 5.5 reads each one.`} label={count ? "Add more PDFs" : "PDFs"} onFiles={(chosen) => flow.setPdfs(withNew(flow.pdfs, chosen))} what={count ? "more PDFs" : "PDFs"} />
		</>
	);
}

/** The pasted DOIs fill the space; entries that are not DOIs are listed under them so nothing is looked up by surprise. */
function DoiUpload({ flow }: { flow: ImportFlowState }) {
	const { dois, invalid } = parseDoiList(flow.doiText);
	return (
		<>
			<UploadHeader aside={dois.length ? `${dois.length} to look up` : undefined} busy={flow.busy} title="DOIs or doi.org links" />
			<textarea
				aria-label="DOIs"
				className="min-h-48 flex-1 resize-none rounded-xl bg-default-100 px-4 py-3 font-mono text-[13px] leading-6 text-black/85 outline-none transition-colors placeholder:font-sans placeholder:text-black/40 hover:bg-default-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 dark:bg-secondary dark:text-white/85 dark:placeholder:text-white/35 dark:hover:bg-white/[4%]"
				disabled={flow.busy}
				onChange={(event) => flow.setDoiText(event.target.value)}
				placeholder={`10.1000/xyz123\nhttps://doi.org/10.1000/abc456\n\nOne per line or separated by commas, up to ${ADMIN_IMPORT_MAX_RECORDS}.`}
				spellCheck={false}
				value={flow.doiText}
			/>
			{invalid.length ? (
				<ul className="flex shrink-0 flex-col gap-1 font-mono text-xs">
					{invalid.slice(0, 4).map((entry) => (
						<li className="flex items-center gap-1.5 text-danger" key={`invalid-${entry}`}>
							<HugeiconsIcon aria-label="Not a DOI" className="shrink-0" icon={AlertCircleIcon} size={12} />
							<span className="min-w-0 flex-1">
								<TruncatedText text={entry} />
							</span>
						</li>
					))}
					{invalid.length > 4 ? <li className="font-sans text-danger">and {invalid.length - 4} more that are not DOIs</li> : null}
				</ul>
			) : null}
		</>
	);
}

const FORMAT_BY_EXTENSION: Record<string, string> = { bib: "BibTeX", bibtex: "BibTeX", json: "CSL JSON", mods: "MODS", nbib: "NBIB", ris: "RIS", txt: "Text", xml: "XML" };
const FILES_PER_PAGE = 8;

function FileUpload({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const count = flow.files.length;
	const { current, items, pages } = pageOf(flow.files, page, FILES_PER_PAGE);
	return (
		<>
			{count ? (
				<>
					<UploadHeader aside={totalSize(flow.files)} busy={flow.busy} onClear={() => flow.setFiles([])} title={`${count} ${count === 1 ? "file" : "files"}`} />
					<div className="shrink-0">
						<ul className="flex flex-col">
							{items.map((file) => (
								<li className="flex h-11 items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={`${file.name}:${file.size}`}>
									<span className="w-16 shrink-0 text-xs font-medium text-black/50 dark:text-white/50">{FORMAT_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "File"}</span>
									<span className="min-w-0 flex-1 text-sm text-black/80 dark:text-white/80">
										<TruncatedText text={file.name} />
									</span>
									<span className="w-14 shrink-0 text-end text-xs tabular-nums text-black/45 dark:text-white/45">{megabytes(file.size)}</span>
									<RemoveButton busy={flow.busy} name={file.name} onPress={() => flow.setFiles(flow.files.filter((other) => other !== file))} />
								</li>
							))}
						</ul>
						<ImportPager label="Pages of chosen files" onChange={setPage} page={current} pages={pages} perPage={FILES_PER_PAGE} total={count} />
					</div>
				</>
			) : null}
			<Dropzone
				accept={ADMIN_IMPORT_FILE_EXTENSIONS}
				busy={flow.busy}
				hint={`${ADMIN_IMPORT_FILE_FORMATS.join(", ")}. Up to ${ADMIN_IMPORT_MAX_FILES} files, 5 MB each.`}
				label={count ? "Add more bibliography files" : "Bibliography files"}
				onFiles={(chosen) => flow.setFiles(withNew(flow.files, chosen))}
				what={count ? "more files" : "bibliography files"}
			/>
		</>
	);
}

/**
 * The Add step, the same in every tab: the settings at the top, then what to
 * import, which fills the rest of the sheet and grows with what is added.
 */
export function ImportAdd({ flow }: { flow: ImportFlowState }) {
	return (
		<div aria-labelledby={`import-source-${flow.kind}`} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]" id="import-source-panel" role="tabpanel">
			<Settings flow={flow} />
			<div className="flex min-h-[18rem] flex-[1_0_auto] flex-col gap-2">
				{flow.kind === "pdfs" ? <PdfUpload flow={flow} /> : flow.kind === "dois" ? <DoiUpload flow={flow} /> : <FileUpload flow={flow} />}
			</div>
		</div>
	);
}
