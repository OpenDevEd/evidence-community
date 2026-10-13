"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";


export const PDF_ACCEPT = "application/pdf,.pdf";

export function megabytes(bytes: number) {
	return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Adds dropped or chosen files once each, by name and size. */
export function withNew(current: readonly File[], chosen: readonly File[]) {
	const known = new Set(current.map((file) => `${file.name}:${file.size}`));
	return [...current, ...chosen.filter((file) => !known.has(`${file.name}:${file.size}`))];
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
			className={`relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${dragging ? "border-accent bg-accent/[0.05]" : "border-black/15 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30"} ${className}`}
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
	maxLength,
	onBlur,
	onChange,
	onKeyDown,
	placeholder,
	value,
}: {
	className: string;
	disabled: boolean;
	label: string;
	maxLength: number;
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
				maxLength={maxLength}
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
/**
 * A numbered list edited in place: each row edits its item, the last row adds
 * one, and a row left empty goes. The AI's checks and instructions both use it.
 */
export function ListEditor({
	addLabel,
	busy,
	intro,
	itemLabel,
	items,
	max,
	maxLength,
	onChange,
}: {
	addLabel: string;
	busy: boolean;
	intro: ReactNode;
	/** One item's name, such as "Check", for its field's label. */
	itemLabel: string;
	items: string[];
	max: number;
	maxLength: number;
	onChange: (items: string[]) => void;
}) {
	const [draft, setDraft] = useState("");
	const full = items.length >= max;
	const add = () => {
		const text = draft.trim();
		if (!text || full) return;
		onChange([...items, text]);
		setDraft("");
	};
	const input = "min-w-0 flex-1 bg-transparent text-sm text-black/85 outline-none placeholder:text-black/40 dark:text-white/85 dark:placeholder:text-white/40";
	const stopNewLine = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter") event.preventDefault();
	};
	const name = itemLabel.toLowerCase();
	return (
		<div>
			<p className="mb-3 text-xs leading-5 text-black/50 dark:text-white/50">{intro}</p>
			<ol className="flex flex-col">
				{items.map((item, index) => (
					<li className="group/item flex items-start gap-2.5 rounded-lg py-1 pe-1 ps-2 hover:bg-black/[0.03] focus-within:bg-black/[0.03] dark:hover:bg-white/[0.04] dark:focus-within:bg-white/[0.04]" key={index}>
						<span className="w-4 shrink-0 pt-1 text-end text-xs leading-5 tabular-nums text-black/40 dark:text-white/40">{index + 1}</span>
						<GrowingText
							className={input}
							disabled={busy}
							label={`${itemLabel} ${index + 1}`}
							maxLength={maxLength}
							onBlur={() => {
								if (!item.trim()) onChange(items.filter((_, other) => other !== index));
							}}
							onChange={(value) => onChange(items.map((text, other) => (other === index ? value : text)))}
							onKeyDown={stopNewLine}
							value={item}
						/>
						<span className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/item:opacity-100">
							<RemoveButton busy={busy} name={`${name} ${index + 1}`} onPress={() => onChange(items.filter((_, other) => other !== index))} />
						</span>
					</li>
				))}
				<li className="flex items-start gap-2.5 rounded-lg py-1 pe-1 ps-2">
					<span className="w-4 shrink-0 pt-1 text-end text-xs leading-5 tabular-nums text-black/30 dark:text-white/30">{items.length + 1}</span>
					<GrowingText
						className={input}
						disabled={busy || full}
						label={addLabel}
						maxLength={maxLength}
						onBlur={add}
						onChange={setDraft}
						onKeyDown={(event) => {
							stopNewLine(event);
							if (event.key === "Enter") add();
						}}
						placeholder={full ? `No room for more ${name}s` : addLabel}
						value={draft}
					/>
				</li>
			</ol>
		</div>
	);
}
