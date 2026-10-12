"use client";

import {
	ArrowDown01Icon,
	ArrowRight01Icon,
	CancelCircleIcon,
	Cancel01Icon,
	CheckListIcon,
	CheckmarkCircle02Icon,
	FileUploadIcon,
	HelpCircleIcon,
	Idea01Icon,
	Pdf01Icon,
	SquareArrowUpRight02Icon,
} from "@hugeicons/core-free-icons";
import { Fragment, useState, useSyncExternalStore } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { Pagination } from "@/components/nextui/Pagination";
import { Progress } from "@/components/nextui/Progress";
import { Spinner } from "@/components/nextui/Spinner";
import { Textarea } from "@/components/nextui/Textarea";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import type { AdminImportCommitResult, PdfCheckResult } from "@/lib/admin/item-import-contract";
import { PDF_IMPORT_MAX_CRITERIA } from "@/lib/admin/item-import-contract";

import { humanizeAdminField } from "./admin-schema";
import { InspectorSection } from "./InspectorSection";
import { IMPORT_STATE_TONE, importRowCells, importRowStatus, storedCheckResults, type PdfRead } from "./admin-import";

const PAGE_SIZE = 8;

const resultLook: Record<PdfCheckResult["result"], { icon: typeof Pdf01Icon; label: string; tone: string; bar: string }> = {
	met: { bar: "bg-emerald-500", icon: CheckmarkCircle02Icon, label: "Met", tone: "text-emerald-700 dark:text-emerald-400" },
	not_met: { bar: "bg-danger", icon: CancelCircleIcon, label: "Not met", tone: "text-danger" },
	unclear: { bar: "bg-amber-500", icon: HelpCircleIcon, label: "Unclear", tone: "text-amber-700 dark:text-amber-400" },
};

function megabytes(bytes: number) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pageRange(page: number, total: number) {
	const first = (page - 1) * PAGE_SIZE + 1;
	return `${first} to ${Math.min(page * PAGE_SIZE, total)} of ${total}`;
}

function PagedFooter({ label, onChange, page, total }: { label: string; onChange: (page: number) => void; page: number; total: number }) {
	const pages = Math.ceil(total / PAGE_SIZE);
	if (pages < 2) return null;
	return (
		<div className="flex items-center gap-3 pt-2">
			<span className="text-xs tabular-nums text-black/55 dark:text-white/55">{pageRange(page, total)}</span>
			<Pagination aria-label={label} className="ms-auto" onChange={onChange} page={page} showControls siblings={0} size="sm" total={pages} />
		</div>
	);
}

export function PdfInputPanel({
	busy,
	criteriaText,
	files,
	inputError,
	onCriteriaChange,
	onFilesChange,
}: {
	busy: boolean;
	criteriaText: string;
	files: File[];
	inputError: string | null;
	onCriteriaChange: (value: string) => void;
	onFilesChange: (files: File[]) => void;
}) {
	const [dragging, setDragging] = useState(false);
	const [page, setPage] = useState(1);
	const add = (chosen: File[]) => {
		const known = new Set(files.map((file) => `${file.name}:${file.size}`));
		onFilesChange([...files, ...chosen.filter((file) => !known.has(`${file.name}:${file.size}`))]);
	};
	const shown = files.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	return (
		<div className="flex flex-col gap-4">
			<div>
				<label
					className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${dragging ? "border-accent bg-accent/[0.06]" : "border-black/15 hover:bg-black/[0.02] dark:border-white/15 dark:hover:bg-white/[0.03]"}`}
					onDragLeave={() => setDragging(false)}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDrop={(event) => {
						event.preventDefault();
						setDragging(false);
						add(Array.from(event.dataTransfer.files));
					}}
				>
					<input
						accept="application/pdf,.pdf"
						aria-label="PDFs"
						className="sr-only"
						disabled={busy}
						multiple
						onChange={(event) => {
							add(Array.from(event.currentTarget.files ?? []));
							event.currentTarget.value = "";
						}}
						type="file"
					/>
					<HugeiconsIcon aria-hidden className="text-black/40 dark:text-white/40" icon={FileUploadIcon} size={20} />
					<span className="font-medium text-black/80 dark:text-white/80">Choose PDFs or drop them here</span>
					<span className="text-xs text-black/50 dark:text-white/50">Up to 100 PDFs, 50 MB each</span>
				</label>
				{files.length ? (
					<>
						<ul className="mt-2 divide-y divide-black/[0.06] rounded-xl border border-black/10 dark:divide-white/[0.06] dark:border-white/10">
							{shown.map((file) => (
								<li className="flex h-9 items-center gap-2 px-3 text-xs" key={`${file.name}:${file.size}`}>
									<HugeiconsIcon aria-hidden className="shrink-0 text-danger/70" icon={Pdf01Icon} size={15} />
									<span className="min-w-0 flex-1">
										<TruncatedText text={file.name} />
									</span>
									<span className="tabular-nums text-black/50 dark:text-white/50">{megabytes(file.size)}</span>
									<Button
										aria-label={`Remove ${file.name}`}
										isDisabled={busy}
										isIconOnly
										onPress={() => {
											const next = files.filter((other) => other !== file);
											onFilesChange(next);
											setPage((current) => Math.min(current, Math.max(1, Math.ceil(next.length / PAGE_SIZE))));
										}}
										size="xs"
										variant="transparent"
									>
										<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={14} />
									</Button>
								</li>
							))}
						</ul>
						<PagedFooter label="Pages of chosen PDFs" onChange={setPage} page={page} total={files.length} />
					</>
				) : null}
				{files.length && inputError ? (
					<p className="mt-2 text-sm text-danger" role="alert">
						{inputError}
					</p>
				) : null}
			</div>
			<div>
				<Textarea
					description={`One check per line, up to ${PDF_IMPORT_MAX_CRITERIA}. Saved for this library and run on every PDF you import.`}
					isDisabled={busy}
					label="Checks"
					labelPlacement="outside"
					minRows={4}
					onValueChange={onCriteriaChange}
					placeholder={"Names the funder of the work\nStates a licence for reuse"}
					value={criteriaText}
				/>
			</div>
		</div>
	);
}

/** One small bar per check, coloured by its result; grey while the PDF is read. */
function CheckMeter({ checks, count }: { checks: PdfCheckResult[] | null; count: number }) {
	if (!count) return <span className="text-black/40 dark:text-white/40">None</span>;
	const met = checks?.filter(({ result }) => result === "met").length ?? 0;
	return (
		<span className="flex items-center gap-2" aria-label={checks ? `${met} of ${count} checks met` : `${count} checks`}>
			<span aria-hidden className="flex gap-0.5">
				{Array.from({ length: count }, (_, index) => (
					<span
						className={`h-3 w-1.5 rounded-sm transition-colors duration-300 ${checks?.[index] ? resultLook[checks[index].result].bar : "bg-black/10 dark:bg-white/10"}`}
						key={index}
					/>
				))}
			</span>
			<span className={`tabular-nums ${checks ? "" : "invisible"}`}>
				{met}/{count}
			</span>
		</span>
	);
}

function PdfCheckList({ checks }: { checks: PdfCheckResult[] }) {
	return (
		<ul className="flex flex-col gap-3">
			{checks.map((check) => {
				const look = resultLook[check.result];
				return (
					<li className="flex gap-2.5" key={check.criterion}>
						<HugeiconsIcon aria-label={look.label} className={`mt-px shrink-0 ${look.tone}`} icon={look.icon} size={16} />
						<div className="min-w-0 flex-1 text-xs leading-5">
							<p className="font-medium text-black/85 dark:text-white/85">{check.criterion}</p>
							{check.quote ? (
								<p className="text-black/60 dark:text-white/60">
									<q>{check.quote}</q>
									{check.page ? (
										<span className="ms-1.5 rounded-md bg-black/[0.05] px-1.5 py-px tabular-nums text-black/55 dark:bg-white/[0.08] dark:text-white/55">
											p. {check.page}
										</span>
									) : null}
								</p>
							) : null}
							{check.recommendation ? (
								<p className="mt-1 flex gap-1.5 text-amber-800 dark:text-amber-300">
									<HugeiconsIcon aria-hidden className="mt-0.5 shrink-0" icon={Idea01Icon} size={13} />
									{check.recommendation}
								</p>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function MetadataChips({ read }: { read: PdfRead }) {
	const payload = read.record?.payload ?? {};
	const chips = [
		read.record?.itemType ? humanizeAdminField(read.record.itemType) : null,
		typeof payload.date === "string" ? payload.date : null,
		typeof payload.publisher === "string" ? payload.publisher : null,
		typeof payload.DOI === "string" ? `DOI ${payload.DOI}` : null,
		typeof payload.language === "string" ? payload.language.toUpperCase() : null,
	].filter(Boolean);
	return (
		<div className="flex flex-wrap gap-1.5">
			{chips.map((chip) => (
				<span className="rounded-md bg-black/[0.05] px-2 py-0.5 text-xs text-black/70 dark:bg-white/[0.08] dark:text-white/70" key={chip}>
					{chip}
				</span>
			))}
		</div>
	);
}

function ReadDetails({ itemKey, onOpenRecord, read }: { itemKey: string | undefined; onOpenRecord: (itemKey: string) => void; read: PdfRead }) {
	const abstract = read.record?.payload?.abstractNote;
	return (
		<div className="grid gap-5 px-3 pb-4 pt-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
			<div className="flex min-w-0 flex-col gap-2.5">
				<MetadataChips read={read} />
				{typeof abstract === "string" ? (
					<p className="line-clamp-6 text-xs leading-5 text-black/65 dark:text-white/65">{abstract}</p>
				) : (
					<p className="text-xs text-black/45 dark:text-white/45">No abstract in the PDF</p>
				)}
				<div className="flex gap-2">
					<Button
						onPress={() => window.open(URL.createObjectURL(read.file), "_blank", "noopener")}
						size="xs"
						startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={14} />}
						variant="muted"
					>
						Open PDF
					</Button>
					{itemKey ? (
						<Button
							onPress={() => onOpenRecord(itemKey)}
							size="xs"
							startContent={<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={14} />}
							variant="muted"
						>
							Open draft
						</Button>
					) : null}
				</div>
			</div>
			{read.checks.length ? <PdfCheckList checks={read.checks} /> : null}
		</div>
	);
}

function ReadStatus({ attach, read, result }: { attach: AttachState | undefined; read: PdfRead; result: AdminImportCommitResult | undefined }) {
	if (read.state === "reading" || read.state === "waiting") {
		return (
			<span className="flex items-center gap-1.5 text-black/55 dark:text-white/55">
				{read.state === "reading" ? <Spinner size="sm" classNames={{ wrapper: "size-3.5" }} /> : null}
				{read.state === "reading" ? "Reading" : "Waiting"}
			</span>
		);
	}
	if (read.state === "failed" || !read.record) {
		return <span className="text-danger">Could not read<StatusDetail text={read.message} /></span>;
	}
	const status = importRowStatus(read.record, result);
	const detail = attach ? attachLabel[attach] : status.detail;
	return (
		<span className={IMPORT_STATE_TONE[status.tone]}>
			{status.label}
			<StatusDetail text={detail} />
		</span>
	);
}

/** One line under the status, so a row keeps its height as it changes. */
function StatusDetail({ text }: { text: string | null | undefined }) {
	if (!text) return null;
	return (
		<span className="block text-black/55 dark:text-white/55">
			<TruncatedText text={text} />
		</span>
	);
}

export type AttachState = "attaching" | "attached" | "failed";
const attachLabel: Record<AttachState, string> = { attached: "PDF attached", attaching: "Attaching the PDF", failed: "The PDF did not attach" };

export function PdfReadProgress({ criteriaCount, reads }: { criteriaCount: number; reads: PdfRead[] }) {
	const done = reads.filter(({ state }) => state === "read" || state === "failed").length;
	const notMet = reads.filter(({ checks }) => checks.some(({ result }) => result !== "met")).length;
	return (
		<div className="flex items-center gap-3 text-xs">
			<Progress aria-label="PDFs read" className="max-w-56" size="sm" value={reads.length ? (done / reads.length) * 100 : 0} />
			<span className="tabular-nums text-black/70 dark:text-white/70">
				{done} of {reads.length} read
			</span>
			{criteriaCount ? (
				<span className={`ms-auto flex items-center gap-1.5 tabular-nums text-amber-700 dark:text-amber-400 ${notMet ? "" : "invisible"}`}>
					<HugeiconsIcon aria-hidden icon={Idea01Icon} size={13} />
					{notMet} with checks to improve
				</span>
			) : null}
		</div>
	);
}

export function PdfPreviewTable({
	attach,
	criteriaCount,
	locked,
	onOpenRecord,
	onSelectedChange,
	reads,
	results,
	selected,
}: {
	attach: ReadonlyMap<string, AttachState>;
	criteriaCount: number;
	locked: boolean;
	onOpenRecord: (itemKey: string) => void;
	onSelectedChange: (selected: Set<string>) => void;
	reads: PdfRead[];
	results: AdminImportCommitResult[] | null;
	selected: Set<string>;
}) {
	const [page, setPage] = useState(1);
	const [open, setOpen] = useState<string | null>(null);
	const readyIds = reads.flatMap(({ id, record }) => (record?.state === "ready" ? [id] : []));
	const resultById = new Map((results ?? []).map((result) => [result.id, result]));
	const all = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
	return (
		<>
			<div className="shrink-0 overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
				<table className="w-full table-fixed text-left text-xs">
					<thead className="bg-background_light dark:bg-card">
						<tr className="h-10 text-black/55 dark:text-white/55">
							<th className="w-9 p-2">
								<Checkbox
									aria-label="Select all ready records"
									isDisabled={locked || !readyIds.length}
									isIndeterminate={selected.size > 0 && !all}
									isSelected={all}
									onValueChange={(checked) => onSelectedChange(new Set(checked ? readyIds : []))}
									size="sm"
								/>
							</th>
							<th className="p-2 font-medium">Title</th>
							<th className="w-32 p-2 font-medium">Creators</th>
							<th className="w-12 p-2 font-medium">Year</th>
							<th className="w-24 p-2 font-medium">Checks</th>
							<th className="w-32 p-2 font-medium">Status</th>
							<th className="w-10 p-2">
								<span className="sr-only">Details</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{reads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((read) => {
							const cells = read.record ? importRowCells(read.record) : null;
							const expanded = open === read.id;
							const settled = read.state === "read" || read.state === "failed";
							return (
								<Fragment key={read.id}>
									<tr className="h-14 border-t border-black/[0.06] align-top dark:border-white/[0.06]">
										<td className="p-2">
											<Checkbox
												aria-label={`Import ${cells?.title ?? read.file.name}`}
												isDisabled={locked || !cells?.selectable}
												isSelected={selected.has(read.id)}
												onValueChange={(checked) => {
													const next = new Set(selected);
													if (checked) next.add(read.id);
													else next.delete(read.id);
													onSelectedChange(next);
												}}
												size="sm"
											/>
										</td>
										<td className="p-2">
											{cells?.title ? (
												<span className="line-clamp-1 font-medium text-black/85 animate-in fade-in duration-300 dark:text-white/85 motion-reduce:animate-none">{cells.title}</span>
											) : (
												<span aria-hidden className={`my-1 block h-3 w-3/4 rounded ${settled ? "" : "animate-pulse bg-black/[0.07] dark:bg-white/[0.08]"}`} />
											)}
											<span className="mt-0.5 flex items-center gap-1 text-black/45 dark:text-white/45">
												<HugeiconsIcon aria-hidden className="shrink-0" icon={Pdf01Icon} size={12} />
												<span className="min-w-0 flex-1">
													<TruncatedText text={read.file.name} />
												</span>
											</span>
										</td>
										<td className="p-2">
											<span className="line-clamp-2">{cells?.creators}</span>
										</td>
										<td className="p-2 tabular-nums">{cells?.year}</td>
										<td className="p-2">
											<CheckMeter checks={settled ? read.checks : null} count={criteriaCount} />
										</td>
										<td className="p-2">
											<ReadStatus attach={attach.get(read.id)} read={read} result={resultById.get(read.id)} />
										</td>
										<td className="p-1.5">
											<Button
												aria-expanded={expanded}
												aria-label={`Details for ${read.file.name}`}
												isDisabled={!read.record}
												isIconOnly
												onPress={() => setOpen(expanded ? null : read.id)}
												size="xs"
												variant="transparent"
											>
												<HugeiconsIcon aria-hidden className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} icon={ArrowDown01Icon} size={15} />
											</Button>
										</td>
									</tr>
									{expanded ? (
										<tr className="bg-black/[0.015] dark:bg-white/[0.02]">
											<td colSpan={7}>
												<ReadDetails itemKey={resultById.get(read.id)?.itemKey} onOpenRecord={onOpenRecord} read={read} />
											</td>
										</tr>
									) : null}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>
			<PagedFooter label="Pages of PDFs" onChange={setPage} page={page} total={reads.length} />
		</>
	);
}

const unchanging = () => () => undefined;

/** What the AI's checks found in the PDF this draft was imported from. */
export function ImportChecksSection({ itemKey }: { itemKey: string }) {
	const stored = useSyncExternalStore(unchanging, () => storedCheckResults(itemKey), () => null);
	if (!stored) return null;
	return (
		<InspectorSection icon={CheckListIcon} id="admin-import-checks" title="Checks">
			<PdfCheckList checks={JSON.parse(stored) as PdfCheckResult[]} />
		</InspectorSection>
	);
}
