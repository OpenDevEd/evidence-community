"use client";

import { AlertCircleIcon, Cancel01Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import {
	ADMIN_IMPORT_FILE_EXTENSIONS,
	ADMIN_IMPORT_FILE_FORMATS,
	ADMIN_IMPORT_MAX_FILES,
	ADMIN_IMPORT_MAX_RECORDS,
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	parseDoiList,
} from "@/lib/admin/item-import-contract";


export const PDF_ACCEPT = "application/pdf,.pdf";

export function megabytes(bytes: number) {
	return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Adds dropped or chosen files once each, by name and size. */
export function withNew(current: readonly File[], chosen: readonly File[]) {
	const known = new Set(current.map((file) => `${file.name}:${file.size}`));
	return [...current, ...chosen.filter((file) => !known.has(`${file.name}:${file.size}`))];
}

function SectionLabel({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
	return (
		<div className="mb-2 flex h-6 items-center gap-2">
			<h3 className="text-sm font-medium text-black/85 dark:text-white/85">{children}</h3>
			{aside ? <span className="ms-auto text-xs tabular-nums text-black/45 dark:text-white/45">{aside}</span> : null}
		</div>
	);
}

/** A drop target that is also a file chooser. */
export function DropArea({
	accept,
	busy,
	children,
	className = "",
	label,
	onFiles,
}: {
	accept: string;
	busy: boolean;
	children: ReactNode;
	className?: string;
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
			className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${dragging ? "border-accent bg-accent/[0.05]" : "border-black/15 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"} ${className}`}
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

export function DropText({ hint, what }: { hint: string; what: string }) {
	return (
		<>
			<HugeiconsIcon aria-hidden className="mb-1 text-black/40 dark:text-white/40" icon={Upload04Icon} size={20} />
			<span className="text-sm text-black/75 dark:text-white/75">
				Drop {what} here, or <span className="font-medium text-accent">browse</span>
			</span>
			<span className="text-xs text-black/45 dark:text-white/45">{hint}</span>
		</>
	);
}

export function RemoveButton({ busy, name, onPress }: { busy: boolean; name: string; onPress: () => void }) {
	return (
		<Tooltip content="Remove">
			<Button aria-label={`Remove ${name}`} className="size-7 min-w-7" isDisabled={busy} isIconOnly onPress={onPress} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={14} />
			</Button>
		</Tooltip>
	);
}

/**
 * A one-line field that wraps and grows with its text: a hidden copy of the
 * text sizes the grid cell the textarea fills.
 */
function GrowingText({
	className,
	disabled,
	label,
	onBlur,
	onChange,
	onKeyDown,
	placeholder,
	value,
}: {
	className: string;
	disabled: boolean;
	label: string;
	onBlur: () => void;
	onChange: (value: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	placeholder?: string;
	value: string;
}) {
	const shared = "col-start-1 row-start-1 whitespace-pre-wrap break-words py-1 text-sm leading-5";
	return (
		<span className="grid min-w-0 flex-1">
			<span aria-hidden className={`${shared} invisible`}>
				{`${value || placeholder || ""} `}
			</span>
			<textarea
				aria-label={label}
				className={`${shared} ${className} resize-none overflow-hidden`}
				disabled={disabled}
				maxLength={PDF_IMPORT_MAX_CRITERION_LENGTH}
				onBlur={onBlur}
				onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				rows={1}
				value={value}
			/>
		</span>
	);
}

/** The library's checks, one per row, saved as they are edited. */
export function ChecksEditor({ busy, criteria, onChange }: { busy: boolean; criteria: string[]; onChange: (criteria: string[]) => void }) {
	const [draft, setDraft] = useState("");
	const full = criteria.length >= PDF_IMPORT_MAX_CRITERIA;
	const add = () => {
		const text = draft.trim();
		if (!text || full) return;
		onChange([...criteria, text]);
		setDraft("");
	};
	const input = "min-w-0 flex-1 bg-transparent text-sm text-black/85 outline-none placeholder:text-black/40 dark:text-white/85 dark:placeholder:text-white/40";
	const stopNewLine = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter") event.preventDefault();
	};
	return (
		<div>
			<p className="mb-3 text-xs leading-5 text-black/50 dark:text-white/50">Saved for this library, up to {PDF_IMPORT_MAX_CRITERIA}. The AI answers each one for every PDF, with the quote and page it rests on.</p>
			<ol className="flex flex-col">
				{criteria.map((criterion, index) => (
					<li className="group/check flex items-start gap-2.5 rounded-lg py-1 pe-1 ps-2 hover:bg-black/[0.03] focus-within:bg-black/[0.03] dark:hover:bg-white/[0.04] dark:focus-within:bg-white/[0.04]" key={index}>
						<span className="w-4 shrink-0 pt-1 text-end text-xs leading-5 tabular-nums text-black/40 dark:text-white/40">{index + 1}</span>
						<GrowingText
							className={input}
							disabled={busy}
							label={`Check ${index + 1}`}
							onBlur={() => {
								if (!criterion.trim()) onChange(criteria.filter((_, other) => other !== index));
							}}
							onChange={(value) => onChange(criteria.map((text, other) => (other === index ? value : text)))}
							onKeyDown={stopNewLine}
							value={criterion}
						/>
						<span className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/check:opacity-100">
							<RemoveButton busy={busy} name={`check ${index + 1}`} onPress={() => onChange(criteria.filter((_, other) => other !== index))} />
						</span>
					</li>
				))}
				<li className="flex items-start gap-2.5 rounded-lg py-1 pe-1 ps-2">
					<span className="w-4 shrink-0 pt-1 text-end text-xs leading-5 tabular-nums text-black/30 dark:text-white/30">{criteria.length + 1}</span>
					<GrowingText
						className={input}
						disabled={busy || full}
						label="Add a check"
						onBlur={add}
						onChange={setDraft}
						onKeyDown={(event) => {
							stopNewLine(event);
							if (event.key === "Enter") add();
						}}
						placeholder={full ? "No room for more checks" : "Add a check"}
						value={draft}
					/>
				</li>
			</ol>
		</div>
	);
}

/** The pasted DOIs, with the entries that are not DOIs listed under them so nothing is looked up by surprise. */
export function DoiInput({ busy, onChange, text }: { busy: boolean; onChange: (text: string) => void; text: string }) {
	const { dois, invalid } = parseDoiList(text);
	return (
		<div>
			<SectionLabel aside={dois.length ? `${dois.length} to look up` : undefined}>DOIs or doi.org links</SectionLabel>
			<Textarea
				aria-label="DOIs"
				classNames={{ input: "min-h-[20rem] font-mono text-[13px] leading-6" }}
				isDisabled={busy}
				maxRows={30}
				minRows={12}
				onValueChange={onChange}
				placeholder={"10.1000/xyz123\nhttps://doi.org/10.1000/abc456"}
				value={text}
			/>
			<p className="mt-2 text-xs text-black/45 dark:text-white/45">One per line or separated by commas, up to {ADMIN_IMPORT_MAX_RECORDS}.</p>
			{invalid.length ? (
				<ul className="mt-3 flex flex-col gap-1 font-mono text-xs">
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
			<DropArea accept={ADMIN_IMPORT_FILE_EXTENSIONS} busy={busy} className={files.length ? "h-24" : "min-h-[31rem]"} label="Bibliography files" onFiles={(chosen) => onFilesChange(withNew(files, chosen))}>
				<DropText hint={`${ADMIN_IMPORT_FILE_FORMATS.join(", ")}. Up to ${ADMIN_IMPORT_MAX_FILES} files, 5 MB each.`} what="bibliography files" />
			</DropArea>
			{files.length ? (
				<ul className="flex flex-col">
					{files.map((file) => (
						<li className="flex h-10 items-center gap-3 rounded-lg pe-1 ps-2 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={`${file.name}:${file.size}`}>
							<span className="w-16 shrink-0 text-xs font-medium text-black/50 dark:text-white/50">{FORMAT_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "File"}</span>
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
