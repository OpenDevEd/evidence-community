"use client";

import {
	Add01Icon,
	AlertCircleIcon,
	CheckListIcon,
	DocumentValidationIcon,
	FileImportIcon,
	FileUploadIcon,
	Cancel01Icon,
	TagsIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useState, type DragEvent, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import {
	ADMIN_IMPORT_FILE_EXTENSIONS,
	ADMIN_IMPORT_MAX_FILES,
	ADMIN_IMPORT_MAX_RECORDS,
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	parseDoiList,
} from "@/lib/admin/item-import-contract";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { PDF_IMPORT_MAX_FILES } from "./admin-import";

const COVERS_PER_PAGE = 9;

function megabytes(bytes: number) {
	return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Adds dropped or chosen files once each, by name and size. */
function withNew(current: readonly File[], chosen: readonly File[]) {
	const known = new Set(current.map((file) => `${file.name}:${file.size}`));
	return [...current, ...chosen.filter((file) => !known.has(`${file.name}:${file.size}`))];
}

/** A drop target that is also a file chooser; the whole area takes a drop. */
function DropArea({
	accept,
	busy,
	children,
	className,
	label,
	onFiles,
}: {
	accept: string;
	busy: boolean;
	children: ReactNode;
	className: string;
	label: string;
	onFiles: (files: File[]) => void;
}) {
	const [dragging, setDragging] = useState(false);
	const drop = (event: DragEvent) => {
		event.preventDefault();
		setDragging(false);
		if (!busy) onFiles(Array.from(event.dataTransfer.files));
	};
	return (
		<label
			className={`group relative cursor-pointer rounded-2xl border border-dashed outline-none transition-[background-color,border-color] duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${dragging ? "border-accent bg-accent/[0.07]" : "border-black/[0.14] bg-white/70 hover:border-black/25 hover:bg-white dark:border-white/15 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"} ${className}`}
			onDragLeave={() => setDragging(false)}
			onDragOver={(event) => {
				event.preventDefault();
				setDragging(true);
			}}
			onDrop={drop}
		>
			<input
				accept={accept}
				aria-label={label}
				className="sr-only"
				disabled={busy}
				multiple
				onChange={(event) => {
					onFiles(Array.from(event.currentTarget.files ?? []));
					event.currentTarget.value = "";
				}}
				type="file"
			/>
			{children}
		</label>
	);
}

function RemoveButton({ busy, name, onPress }: { busy: boolean; name: string; onPress: () => void }) {
	return (
		<Tooltip content="Remove">
			<Button aria-label={`Remove ${name}`} className="size-7 min-w-7" isDisabled={busy} isIconOnly onPress={onPress} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={14} />
			</Button>
		</Tooltip>
	);
}

const PROMISES = [
	{ icon: DocumentValidationIcon, label: "Title, authors, date and DOI" },
	{ icon: TagsIcon, label: "OpenAlex topics" },
	{ icon: CheckListIcon, label: "Your library's checks" },
];

function PdfHero({ busy, onFiles }: { busy: boolean; onFiles: (files: File[]) => void }) {
	return (
		<DropArea accept="application/pdf,.pdf" busy={busy} className="flex min-h-[17rem] flex-col items-center justify-center gap-4 px-6 py-10 text-center" label="PDFs" onFiles={onFiles}>
			<span className="relative flex h-16 w-24 items-end justify-center">
				<span className="absolute bottom-0 h-14 w-11 -translate-x-5 -rotate-12 rounded-md bg-white shadow-card-lifted ring-1 ring-black/[0.08] transition-transform duration-300 group-hover:-translate-x-7 group-hover:-rotate-[16deg] dark:bg-white/10 dark:ring-white/10" />
				<span className="absolute bottom-0 h-14 w-11 translate-x-5 rotate-12 rounded-md bg-white shadow-card-lifted ring-1 ring-black/[0.08] transition-transform duration-300 group-hover:translate-x-7 group-hover:rotate-[16deg] dark:bg-white/10 dark:ring-white/10" />
				<span className="relative flex h-16 w-12 items-center justify-center rounded-md bg-accent text-white shadow-[0_10px_24px_-12px_rgba(235,126,29,0.8)] transition-transform duration-300 group-hover:-translate-y-1">
					<HugeiconsIcon aria-hidden icon={FileUploadIcon} size={22} />
				</span>
			</span>
			<span>
				<span className="block text-base font-semibold text-black/85 dark:text-white/85">Drop PDFs here</span>
				<span className="mt-1 block text-sm text-black/50 dark:text-white/50">or click to choose. Up to {PDF_IMPORT_MAX_FILES} at once, 50 MB each.</span>
			</span>
			<span className="flex flex-wrap justify-center gap-2">
				{PROMISES.map(({ icon, label }) => (
					<span className="flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1 text-xs text-black/60 dark:bg-white/[0.06] dark:text-white/60" key={label}>
						<HugeiconsIcon aria-hidden className="text-accent" icon={icon} size={13} />
						{label}
					</span>
				))}
			</span>
		</DropArea>
	);
}

function CoverGrid({ busy, files, onFilesChange }: { busy: boolean; files: File[]; onFilesChange: (files: File[]) => void }) {
	const [page, setPage] = useState(1);
	const { items, pages } = pageOf(files, page, COVERS_PER_PAGE);
	const total = files.reduce((sum, file) => sum + file.size, 0);
	const remove = (file: File) => {
		const next = files.filter((other) => other !== file);
		onFilesChange(next);
		setPage((current) => Math.min(current, Math.max(1, Math.ceil(next.length / COVERS_PER_PAGE))));
	};
	return (
		<section>
			<div className="mb-3 flex items-center gap-3">
				<h3 className="text-sm font-semibold text-black/85 dark:text-white/85">
					{files.length} {files.length === 1 ? "PDF" : "PDFs"}
				</h3>
				<span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-xs tabular-nums text-black/55 dark:bg-white/[0.07] dark:text-white/55">{megabytes(total)}</span>
				<Button className="ms-auto" isDisabled={busy} onPress={() => onFilesChange([])} size="xs" variant="transparent">
					Clear all
				</Button>
			</div>
			<ul className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-5">
				<li>
					<DropArea accept="application/pdf,.pdf" busy={busy} className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 text-xs font-medium text-black/55 dark:text-white/55" label="Add more PDFs" onFiles={(chosen) => onFilesChange(withNew(files, chosen))}>
						<span className="flex size-8 items-center justify-center rounded-full bg-accent/10 text-accent transition-transform duration-200 group-hover:scale-110">
							<HugeiconsIcon aria-hidden icon={Add01Icon} size={16} />
						</span>
						Add more
					</DropArea>
				</li>
				{items.map((file) => (
					<li className="group/cover relative min-w-0" key={`${file.name}:${file.size}`}>
						<ImportCover className="w-full transition-transform duration-200 group-hover/cover:-translate-y-0.5" file={file} size={22} />
						<span className="absolute end-1 top-1 rounded-lg bg-white/90 opacity-0 shadow-sm backdrop-blur transition-opacity duration-150 focus-within:opacity-100 group-hover/cover:opacity-100 dark:bg-black/60">
							<RemoveButton busy={busy} name={file.name} onPress={() => remove(file)} />
						</span>
						<span className="mt-2 block text-xs font-medium leading-4 text-black/75 dark:text-white/75">
							<TruncatedText text={file.name} />
						</span>
						<span className="block text-[11px] tabular-nums text-black/45 dark:text-white/45">{megabytes(file.size)}</span>
					</li>
				))}
			</ul>
			<ImportPager label="Pages of chosen PDFs" onChange={setPage} page={page} pages={pages} perPage={COVERS_PER_PAGE} total={files.length} />
		</section>
	);
}

/** The library's checks, one per row, saved as they are edited. */
function ChecksEditor({ busy, criteria, onChange }: { busy: boolean; criteria: string[]; onChange: (criteria: string[]) => void }) {
	const [draft, setDraft] = useState("");
	const full = criteria.length >= PDF_IMPORT_MAX_CRITERIA;
	const add = () => {
		const text = draft.trim();
		if (!text || full) return;
		onChange([...criteria, text]);
		setDraft("");
	};
	return (
		<section>
			<div className="flex items-center gap-3">
				<h3 className="text-sm font-semibold text-black/85 dark:text-white/85">Checks</h3>
				<span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-xs tabular-nums text-black/55 dark:bg-white/[0.07] dark:text-white/55">
					{criteria.length} of {PDF_IMPORT_MAX_CRITERIA}
				</span>
			</div>
			<p className="mt-1 text-xs text-black/50 dark:text-white/50">Saved for this library. Every PDF gets an answer to each, with the quote and page it rests on.</p>
			<ol className="mt-3 divide-y divide-black/[0.06] overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.08] dark:divide-white/[0.06] dark:bg-white/[0.03] dark:ring-white/10">
				{criteria.map((criterion, index) => (
					<li className="group/check flex h-11 items-center gap-3 ps-3 pe-1.5" key={index}>
						<span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent/10 text-[11px] font-semibold tabular-nums text-accent">{index + 1}</span>
						<input
							aria-label={`Check ${index + 1}`}
							className="min-w-0 flex-1 bg-transparent text-sm text-black/85 outline-none dark:text-white/85"
							disabled={busy}
							maxLength={PDF_IMPORT_MAX_CRITERION_LENGTH}
							onBlur={() => {
								if (!criterion.trim()) onChange(criteria.filter((_, other) => other !== index));
							}}
							onChange={(event) => onChange(criteria.map((value, other) => (other === index ? event.target.value : value)))}
							value={criterion}
						/>
						<span className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/check:opacity-100">
							<RemoveButton busy={busy} name={`check ${index + 1}`} onPress={() => onChange(criteria.filter((_, other) => other !== index))} />
						</span>
					</li>
				))}
				<li className="flex h-11 items-center gap-3 px-3">
					<span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-black/20 text-black/40 dark:border-white/20 dark:text-white/40">
						<HugeiconsIcon aria-hidden icon={Add01Icon} size={12} />
					</span>
					<input
						aria-label="Add a check"
						className="min-w-0 flex-1 bg-transparent text-sm text-black/85 outline-none placeholder:text-black/40 dark:text-white/85 dark:placeholder:text-white/40"
						disabled={busy || full}
						maxLength={PDF_IMPORT_MAX_CRITERION_LENGTH}
						onBlur={add}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") add();
						}}
						placeholder={full ? "This library has the most checks it can hold" : "Add a check, then press Enter"}
						value={draft}
					/>
				</li>
			</ol>
		</section>
	);
}

export function PdfInput({
	busy,
	criteria,
	files,
	onCriteriaChange,
	onFilesChange,
}: {
	busy: boolean;
	criteria: string[];
	files: File[];
	onCriteriaChange: (criteria: string[]) => void;
	onFilesChange: (files: File[]) => void;
}) {
	return (
		<div className="flex flex-col gap-7">
			{files.length ? (
				<CoverGrid busy={busy} files={files} onFilesChange={onFilesChange} />
			) : (
				<PdfHero busy={busy} onFiles={(chosen) => onFilesChange(withNew(files, chosen))} />
			)}
			<ChecksEditor busy={busy} criteria={criteria} onChange={onCriteriaChange} />
		</div>
	);
}

export function DoiInput({ busy, onChange, text }: { busy: boolean; onChange: (text: string) => void; text: string }) {
	const { dois, invalid } = parseDoiList(text);
	return (
		<div className="flex flex-col gap-3">
			<Textarea
				aria-label="DOIs"
				classNames={{ input: "min-h-[17rem] font-mono text-[13px] leading-6" }}
				isDisabled={busy}
				maxRows={30}
				minRows={12}
				onValueChange={onChange}
				placeholder={"10.1000/xyz123\nhttps://doi.org/10.1000/abc456"}
				value={text}
			/>
			<div className="flex min-h-7 flex-wrap items-center gap-2 text-xs">
				<span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium tabular-nums transition-colors duration-200 ${dois.length ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-black/[0.04] text-black/45 dark:bg-white/[0.06] dark:text-white/45"}`}>
					<HugeiconsIcon aria-hidden icon={Tick02Icon} size={13} />
					{dois.length} {dois.length === 1 ? "DOI" : "DOIs"}
				</span>
				{invalid.slice(0, 4).map((entry) => (
					<span className="flex max-w-48 items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-danger" key={entry}>
						<HugeiconsIcon aria-hidden className="shrink-0" icon={AlertCircleIcon} size={13} />
						<TruncatedText text={entry} />
					</span>
				))}
				{invalid.length > 4 ? <span className="text-danger">and {invalid.length - 4} more that are not DOIs</span> : null}
				<span className="ms-auto text-black/45 dark:text-white/45">One per line or separated by commas, up to {ADMIN_IMPORT_MAX_RECORDS}</span>
			</div>
		</div>
	);
}

const FORMAT_BY_EXTENSION: Record<string, string> = {
	bib: "BibTeX",
	bibtex: "BibTeX",
	json: "CSL JSON",
	mods: "MODS",
	nbib: "NBIB",
	ris: "RIS",
	txt: "Text",
	xml: "XML",
};

export function BibliographyInput({ busy, files, onFilesChange }: { busy: boolean; files: File[]; onFilesChange: (files: File[]) => void }) {
	return (
		<div className="flex flex-col gap-4">
			<DropArea accept={ADMIN_IMPORT_FILE_EXTENSIONS} busy={busy} className={`flex items-center gap-4 px-5 ${files.length ? "h-20" : "min-h-[15rem] flex-col justify-center text-center"}`} label="Bibliography files" onFiles={(chosen) => onFilesChange(withNew(files, chosen))}>
				<span className={`flex shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_10px_24px_-12px_rgba(235,126,29,0.8)] transition-transform duration-200 group-hover:-translate-y-0.5 ${files.length ? "size-10" : "size-14"}`}>
					<HugeiconsIcon aria-hidden icon={FileImportIcon} size={files.length ? 18 : 24} />
				</span>
				<span>
					<span className="block text-sm font-semibold text-black/85 dark:text-white/85">{files.length ? "Add more files" : "Drop bibliography files here"}</span>
					<span className="block text-xs text-black/50 dark:text-white/50">RIS, BibTeX, BibLaTeX, CSL JSON, EndNote XML, MODS, MARCXML or NBIB. Up to {ADMIN_IMPORT_MAX_FILES} files, 5 MB each.</span>
				</span>
			</DropArea>
			{files.length ? (
				<ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.08] dark:divide-white/[0.06] dark:bg-white/[0.03] dark:ring-white/10">
					{files.map((file) => (
						<li className="flex h-12 items-center gap-3 ps-3 pe-1.5 text-sm" key={`${file.name}:${file.size}`}>
							<span className="w-16 shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-center text-[11px] font-semibold text-accent">
								{FORMAT_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "File"}
							</span>
							<span className="min-w-0 flex-1 text-black/80 dark:text-white/80">
								<TruncatedText text={file.name} />
							</span>
							<span className="text-xs tabular-nums text-black/45 dark:text-white/45">{megabytes(file.size)}</span>
							<RemoveButton busy={busy} name={file.name} onPress={() => onFilesChange(files.filter((other) => other !== file))} />
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
