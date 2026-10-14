"use client";

import { AlertCircleIcon, Book02Icon, CheckListIcon, Folder01Icon, Link01Icon, NoteEditIcon, Pdf01Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import { ADMIN_IMPORT_FILE_EXTENSIONS, ADMIN_IMPORT_FILE_FORMATS, ADMIN_IMPORT_MAX_FILES, ADMIN_IMPORT_MAX_RECORDS, PDF_IMPORT_MAX_CRITERIA, PDF_IMPORT_MAX_CRITERION_LENGTH, PDF_IMPORT_MAX_FILES, PDF_IMPORT_MAX_GUIDANCE_LENGTH, parseDoiList } from "@/lib/admin/item-import-contract";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import { DropArea, ListEditor, megabytes, PDF_ACCEPT, RemoveButton, withNew } from "./ImportInputs";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportKind } from "./ImportSteps";
import { countSummary, ListHeader, PdfRows, Setting, SettingsGroup, SheetTabs } from "./import-parts";
import type { ImportFlowState } from "./import-flow";
import { reviewCounts } from "./admin-import";

const SOURCES: { icon: typeof Pdf01Icon; id: ImportKind; label: string }[] = [
	{ icon: Pdf01Icon, id: "pdfs", label: "PDFs" },
	{ icon: Link01Icon, id: "dois", label: "DOIs" },
	{ icon: Book02Icon, id: "files", label: "Bibliography files" },
];

/** What to import from. */
export function SourceTabs({ flow }: { flow: ImportFlowState }) {
	return <SheetTabs disabled={flow.busy} label="Import from" onSelect={flow.setKind} panelId="import-source-panel" selected={flow.kind} tabs={SOURCES} />;
}

const INSTRUCTIONS_EXAMPLE = ["Write in British English.", "Don't copy the PDF's abstract. Write three sentences for a policy reader instead.", "Give an organisation's full name as the author, not its acronym."].join("\n");

/**
 * The library's instructions for the AI, written freely in a box of their
 * own, one per line: something to write in, unlike the checks, which are a
 * list of questions.
 */
function InstructionsEditor({ flow }: { flow: ImportFlowState }) {
	const text = flow.instructions.join("\n");
	// A hidden copy of the text sizes the box, so it grows with what is written.
	const shared = "col-start-1 row-start-1 whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6";
	return (
		<div>
			<p className="mb-3 text-xs leading-5 text-black/50 dark:text-white/50">Given to the AI with every PDF it reads, and kept for the library&rsquo;s next import. They win over how it works by default, but never make it invent facts.</p>
			<div className="overflow-hidden rounded-xl bg-card_light shadow-sm ring-1 ring-black/[0.07] transition-shadow focus-within:ring-2 focus-within:ring-focus dark:bg-white/[0.05] dark:ring-white/[0.08]">
				<div className="grid min-h-[8.5rem]">
					<span aria-hidden className={`${shared} invisible`}>{`${text || INSTRUCTIONS_EXAMPLE} `}</span>
					<textarea
						aria-label="AI instructions"
						className={`${shared} resize-none overflow-hidden bg-transparent text-black/85 outline-none placeholder:text-black/35 disabled:opacity-50 dark:text-white/85 dark:placeholder:text-white/30`}
						disabled={flow.busy}
						maxLength={PDF_IMPORT_MAX_GUIDANCE_LENGTH}
						onChange={(event) => flow.setInstructions(event.target.value.split("\n"))}
						placeholder={INSTRUCTIONS_EXAMPLE}
						value={text}
					/>
				</div>
				<div className="flex h-9 items-center gap-3 border-t border-black/[0.05] px-4 text-xs text-black/45 dark:border-white/[0.06] dark:text-white/45">
					<span>One instruction per line</span>
					<span className="ms-auto tabular-nums">
						{text.length.toLocaleString("en-GB")} of {PDF_IMPORT_MAX_GUIDANCE_LENGTH.toLocaleString("en-GB")}
					</span>
				</div>
			</div>
		</div>
	);
}

/** Where the new drafts go, on the Add step and again in the review. */
export function CollectionsSetting({ flow }: { flow: ImportFlowState }) {
	return (
		<Setting icon={Folder01Icon} summary={countSummary(flow.collections.length, "chosen", "chosen", "None")} title="Collections">
			<p className="mb-3 text-xs leading-5 text-black/50 dark:text-white/50">The new drafts go into these.</p>
			{/* Locked while a lookup or the import runs: the batch takes the collections chosen when it starts. */}
			<CollectionsLock locked={flow.busy || flow.locked}>
				<AdminCollectionPicker
					allowedSourceKeys={editableItemCollectionSourceKeysForItems([NATIVE_SOURCE_CONNECTION_KEY], flow.sources)}
					onSelectionChange={flow.setCollections}
					selectedKeys={flow.collections}
					selectionMode="multiple"
					sources={flow.sources}
				/>
			</CollectionsLock>
		</Setting>
	);
}

function CollectionsLock({ children, locked }: { children: ReactNode; locked: boolean }) {
	return (
		<div className={`transition-opacity ${locked ? "opacity-50" : ""}`} inert={locked}>
			{children}
		</div>
	);
}

/** The settings an editor keeps changing, at the top: what the AI checks and follows for PDFs, and where the drafts go. */
function Settings({ flow }: { flow: ImportFlowState }) {
	const instructions = flow.instructions.filter((item) => item.trim()).length;
	return (
		<SettingsGroup>
			{flow.kind === "pdfs" ? (
				<>
					<Setting icon={CheckListIcon} summary={countSummary(flow.checks.length, "check", "checks", "None yet")} title="AI checks">
						<ListEditor
							addLabel="Add a check"
							busy={flow.busy}
							intro={`Up to ${PDF_IMPORT_MAX_CRITERIA}. The AI answers each one for every PDF, with the quote and page it rests on. The library's next import starts from these.`}
							itemLabel="Check"
							items={flow.checks}
							max={PDF_IMPORT_MAX_CRITERIA}
							maxLength={PDF_IMPORT_MAX_CRITERION_LENGTH}
							onChange={flow.setChecks}
						/>
					</Setting>
					<Setting icon={NoteEditIcon} summary={countSummary(instructions, "instruction", "instructions", "None yet")} title="AI instructions">
						<InstructionsEditor flow={flow} />
					</Setting>
				</>
			) : null}
			<CollectionsSetting flow={flow} />
		</SettingsGroup>
	);
}

/** What was added so far, its size, and a way to start again. */
function UploadHeader({ aside, busy, onClear, title }: { aside?: ReactNode; busy: boolean; onClear?: () => void; title: string }) {
	return (
		<ListHeader
			action={
				onClear ? (
					<Button className="h-7 min-h-7" isDisabled={busy} onPress={onClear} size="xs" variant="transparent">
						Clear all
					</Button>
				) : undefined
			}
			aside={aside}
			title={title}
		/>
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

/**
 * The library's open PDF import, in place of the drop box: only one is open
 * at a time, so more PDFs wait until it is imported or discarded.
 */
function OpenPdfImport({ batch }: { batch: NonNullable<ImportFlowState["openPdfs"]> }) {
	const { done, total } = reviewCounts(batch);
	return (
		<div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-black/15 px-6 text-center dark:border-white/15">
			<HugeiconsIcon aria-hidden className="text-black/35 dark:text-white/35" icon={Pdf01Icon} size={22} />
			<p className="text-sm font-medium text-black/80 dark:text-white/80">
				{total} {total === 1 ? "PDF" : "PDFs"} in the open import
			</p>
			<div aria-label="PDFs read" aria-valuemax={total} aria-valuemin={0} aria-valuenow={done} className="h-1.5 w-48 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar">
				<div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
			</div>
			<p className="text-xs tabular-nums text-black/50 dark:text-white/50">
				{done} of {total} read. Import or discard it to read more PDFs.
			</p>
		</div>
	);
}

function PdfUpload({ flow }: { flow: ImportFlowState }) {
	if (flow.openPdfs) return <OpenPdfImport batch={flow.openPdfs} />;
	const count = flow.pdfs.length;
	return (
		<>
			{count ? (
				<>
					<UploadHeader
						aside={totalSize(flow.pdfs)}
						busy={flow.busy}
						onClear={() => flow.setPdfs([])}
						title={`${count} ${count === 1 ? "PDF" : "PDFs"}`}
					/>
					<PdfRows busy={flow.busy} files={flow.pdfs} onFilesChange={flow.setPdfs} perPage={8} />
				</>
			) : (
				<Dropzone accept={PDF_ACCEPT} busy={flow.busy} hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each. The library's AI reads each one.`} label="PDFs" onFiles={(chosen) => flow.setPdfs(withNew(flow.pdfs, chosen))} what="PDFs" />
			)}
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
			) : (
				<Dropzone
					accept={ADMIN_IMPORT_FILE_EXTENSIONS}
					busy={flow.busy}
					hint={`${ADMIN_IMPORT_FILE_FORMATS.join(", ")}. Up to ${ADMIN_IMPORT_MAX_FILES} files, 5 MB each.`}
					label="Bibliography files"
					onFiles={(chosen) => flow.setFiles(withNew(flow.files, chosen))}
					what="bibliography files"
				/>
			)}
		</>
	);
}

const droppedFilesName = (kind: ImportKind) => (kind === "pdfs" ? "PDFs" : "bibliography files");

/** Files can be dropped on the Add step of a source that takes files, while nothing else runs. */
const takesDrops = (flow: ImportFlowState) => flow.stage === "input" && flow.fileKind !== null && !flow.busy;

/**
 * The whole sheet takes dropped PDFs or bibliography files, wherever its list
 * has scrolled to, so there is no drop box to find. While files are dragged
 * over it, the sheet says it will take them.
 */
export function SheetDrop({ children, flow }: { children: ReactNode; flow: ImportFlowState }) {
	const reduceMotion = useReducedMotion();
	const [dragging, setDragging] = useState(false);
	// Entering a child fires before leaving its parent, so count to know when the drag has left the sheet.
	const depth = useRef(0);
	const accepts = takesDrops(flow);
	const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
	const stop = () => {
		depth.current = 0;
		setDragging(false);
	};
	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			onDragEnter={(event) => {
				if (!accepts || !carriesFiles(event)) return;
				depth.current += 1;
				setDragging(true);
			}}
			onDragLeave={() => {
				if (!dragging) return;
				depth.current -= 1;
				if (depth.current <= 0) stop();
			}}
			onDragOver={(event) => {
				if (accepts && carriesFiles(event)) event.preventDefault();
			}}
			onDrop={(event) => {
				stop();
				// The empty list's own drop box has taken them already.
				if (!accepts || event.defaultPrevented) return;
				event.preventDefault();
				const chosen = Array.from(event.dataTransfer.files);
				if (flow.kind === "pdfs") flow.setPdfs(withNew(flow.pdfs, chosen));
				else flow.setFiles(withNew(flow.files, chosen));
			}}
		>
			{children}
			<AnimatePresence>
				{dragging ? (
					<motion.div
						animate={{ opacity: 1 }}
						className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-card_light/95 dark:bg-card/95"
						exit={{ opacity: 0 }}
						initial={{ opacity: 0 }}
						transition={{ duration: reduceMotion ? 0 : 0.15 }}
					>
						<HugeiconsIcon aria-hidden className="text-accent" icon={Upload04Icon} size={26} />
						<p className="text-sm font-medium text-black/85 dark:text-white/85">Drop to add {droppedFilesName(flow.kind)}</p>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/** Says, beside the upload button, that files can be dropped anywhere on the sheet. */
export function DropHint({ flow }: { flow: ImportFlowState }) {
	if (flow.stage !== "input" || !flow.fileKind) return null;
	return <p className="min-w-0 flex-1 text-xs leading-5 text-black/50 dark:text-white/50">Drop {droppedFilesName(flow.fileKind)} anywhere on this sheet</p>;
}

/** Choose PDFs or bibliography files from the footer, beside the button that reads them. */
export function UploadButton({ flow }: { flow: ImportFlowState }) {
	const input = useRef<HTMLInputElement>(null);
	if (!flow.fileKind) return null;
	const pdfs = flow.fileKind === "pdfs";
	return (
		<>
			<input
				accept={pdfs ? PDF_ACCEPT : ADMIN_IMPORT_FILE_EXTENSIONS}
				aria-hidden
				className="hidden"
				multiple
				onChange={(event) => {
					const chosen = Array.from(event.currentTarget.files ?? []);
					if (pdfs) flow.setPdfs(withNew(flow.pdfs, chosen));
					else flow.setFiles(withNew(flow.files, chosen));
					event.currentTarget.value = "";
				}}
				ref={input}
				tabIndex={-1}
				type="file"
			/>
			<Button className="shrink-0" isDisabled={flow.busy} onPress={() => input.current?.click()} size="sm" startContent={<HugeiconsIcon aria-hidden icon={Upload04Icon} size={15} />} variant="muted">
				{pdfs ? "Upload PDFs" : "Upload files"}
			</Button>
		</>
	);
}

/**
 * The Add step, the same in every tab: the settings at the top, then what to
 * import, which fills the rest of the sheet and grows with what is added.
 */
export function ImportAdd({ flow }: { flow: ImportFlowState }) {
	return (
		<div aria-labelledby={`import-source-panel-tab-${flow.kind}`} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]" id="import-source-panel" role="tabpanel">
			{flow.pdfsWaiting ? null : <Settings flow={flow} />}
			<div className="flex min-h-[18rem] flex-[1_0_auto] flex-col gap-2">
				{flow.kind === "pdfs" ? <PdfUpload flow={flow} /> : flow.kind === "dois" ? <DoiUpload flow={flow} /> : <FileUpload flow={flow} />}
			</div>
		</div>
	);
}
