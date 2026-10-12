"use client";

import { Folder01Icon } from "@hugeicons/core-free-icons";
import { ModalContent, Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { toast } from "sonner";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import { parseDoiList, type AdminImportCommitResult } from "@/lib/admin/item-import-contract";
import type { AdminSource } from "@/lib/admin/types";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import { ImportDone } from "./ImportDone";
import { BibliographyInput, DoiInput, PdfInput } from "./ImportInputs";
import { ReviewBar, ReviewDetail, ReviewList, type AttachState } from "./ImportReview";
import { ImportSteps, type ImportKind, type ImportStage } from "./ImportSteps";
import { AdminApiError, commitAdminImport, createAdminDraft, previewAdminImport, readAdminImportPdf } from "./admin-api";
import {
	doiPreviewRequest,
	filePreviewRequest,
	initialTopicChoice,
	pendingPdfRows,
	readPdfs,
	reviewCounts,
	reviewMatches,
	rowsFromRecords,
	selectedImportRecords,
	storeCriteria,
	storedCriteria,
	storeReview,
	summarizeImportResults,
	validateCriteria,
	validateImportFiles,
	validatePdfFiles,
	type ImportRow,
	type ReviewFilter,
} from "./admin-import";
import { uploadPdfFile } from "./admin-pdf";

type Review = { importId: string; rows: ImportRow[] };

function errorMessage(error: unknown) {
	if (error instanceof AdminApiError) {
		const fieldMessages = Object.values(error.fields);
		return fieldMessages.length ? `${error.message} ${fieldMessages.join(" ")}` : error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function inputError(kind: ImportKind, doiText: string, files: readonly File[], pdfs: readonly File[], criteria: readonly string[]) {
	try {
		if (kind === "dois") doiPreviewRequest(doiText);
		else if (kind === "files") validateImportFiles(files);
		else {
			validatePdfFiles(pdfs);
			validateCriteria(criteria);
		}
		return null;
	} catch (error) {
		return errorMessage(error);
	}
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "Read 5 PDFs", or "Read PDFs" before there are any. */
const action = (verb: string, count: number, one: string, many: string) => (count ? `${verb} ${plural(count, one, many)}` : `${verb} ${many}`);

/**
 * Import records from PDFs, a pasted DOI list or bibliography files. PDFs are
 * read by AI, which fills their metadata, judges their OpenAlex topics and
 * answers the library's checks. Every source ends in the same review, and the
 * chosen records become unpublished drafts in one call.
 */
export function AdminImportDialog({
	isOpen,
	onClose,
	onImported,
	onOpenRecord,
	sources,
}: {
	isOpen: boolean;
	onClose: () => void;
	onImported: (itemKeys: string[]) => Promise<void> | void;
	onOpenRecord: (itemKey: string) => void;
	sources: readonly AdminSource[];
}) {
	return (
		<DialogModal
			classNames={{ base: "h-[min(46rem,calc(100dvh-2rem))] max-w-[68rem] overflow-hidden" }}
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			size="5xl"
		>
			<ModalContent>{isOpen ? <ImportFlow onClose={onClose} onImported={onImported} onOpenRecord={onOpenRecord} sources={sources} /> : null}</ModalContent>
		</DialogModal>
	);
}

function ImportFlow({
	onClose,
	onImported,
	onOpenRecord,
	sources,
}: {
	onClose: () => void;
	onImported: (itemKeys: string[]) => Promise<void> | void;
	onOpenRecord: (itemKey: string) => void;
	sources: readonly AdminSource[];
}) {
	const topicsEnabled = useLibraryConfig().topics.enabled;
	const reduceMotion = useReducedMotion();
	const [kind, setKind] = useState<ImportKind>("pdfs");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [pdfs, setPdfs] = useState<File[]>([]);
	const [criteria, setCriteria] = useState(storedCriteria);
	const [review, setReview] = useState<Review | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [filter, setFilter] = useState<ReviewFilter>("all");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [topicChoice, setTopicChoice] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
	const [collections, setCollections] = useState<string[]>([]);
	const [results, setResults] = useState<AdminImportCommitResult[] | null>(null);
	const [attach, setAttach] = useState<ReadonlyMap<string, AttachState>>(new Map());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const stage: ImportStage = results ? "done" : review ? "review" : "input";
	const problem = inputError(kind, doiText, files, pdfs, criteria);
	const rows = review?.rows ?? [];
	const counts = reviewCounts(rows);
	const reading = kind === "pdfs" && counts.done < counts.total;
	const shown = rows.filter((row) => reviewMatches(row, filter));
	const activeRow = rows.find(({ id }) => id === activeId) ?? shown[0] ?? null;
	const resultById = new Map((results ?? []).map((result) => [result.id, result]));

	const run = async (work: () => Promise<void>) => {
		setError(null);
		setBusy(true);
		try {
			await work();
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const changeRow = (row: ImportRow) => {
		setReview((current) => current && { ...current, rows: current.rows.map((other) => (other.id === row.id ? row : other)) });
		if (row.state !== "read") return;
		setTopicChoice((current) => new Map(current).set(row.id, initialTopicChoice(row.topics)));
		if (row.record?.state === "ready") setSelected((current) => new Set(current).add(row.id));
	};

	const start = () =>
		run(async () => {
			setFilter("all");
			if (kind === "pdfs") {
				storeCriteria(criteria);
				const pending = pendingPdfRows(pdfs);
				setSelected(new Set());
				setActiveId(pending[0]?.id ?? null);
				setReview({ importId: crypto.randomUUID(), rows: pending });
				await readPdfs(pending, (file) => readAdminImportPdf(file, criteria), changeRow, errorMessage);
				return;
			}
			const response = await previewAdminImport(kind === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest(files));
			const previewRows = rowsFromRecords(response.records);
			setActiveId(previewRows[0]?.id ?? null);
			setSelected(new Set(previewRows.flatMap(({ id, record }) => (record?.state === "ready" ? [id] : []))));
			setReview({ importId: crypto.randomUUID(), rows: previewRows });
		});

	const attachPdfs = async (created: AdminImportCommitResult[]) => {
		const rowById = new Map(rows.map((row) => [row.id, row]));
		const mark = (id: string, state: AttachState) => setAttach((current) => new Map(current).set(id, state));
		for (const { id } of created) mark(id, "attaching");
		await Promise.all(
			created.map(async ({ id, itemKey }) => {
				const row = rowById.get(id);
				if (!row?.file || !itemKey) return;
				try {
					const attachment = await createAdminDraft({ collections: [], itemType: "attachment", parentItem: itemKey, tags: [], title: row.file.name });
					await uploadPdfFile(attachment.itemKey, row.file, () => undefined);
					mark(id, "attached");
				} catch (caught) {
					console.error("Attaching the PDF failed", row.file.name, caught);
					mark(id, "failed");
				}
			}),
		);
	};

	const commit = () =>
		run(async () => {
			if (!review) return;
			const chosen = (id: string) => [...(topicChoice.get(id) ?? [])];
			const records = selectedImportRecords(
				rows.flatMap(({ record }) => (record ? [record] : [])),
				selected,
			).map((record) => (topicsEnabled && chosen(record.id).length ? { ...record, payload: { ...record.payload, topics: chosen(record.id) } } : record));
			const response = await commitAdminImport({ collections, importId: review.importId, records });
			setResults(response.results);
			const created = response.results.filter(({ itemKey, outcome }) => outcome === "created" && itemKey);
			for (const { id, itemKey } of created) {
				const row = rows.find((other) => other.id === id);
				if (row) storeReview(itemKey!, { checks: row.checks, topics: row.topics.filter((topic) => topicChoice.get(id)?.has(topic.id)) });
			}
			const summary = summarizeImportResults(response.results);
			if (kind === "pdfs") void attachPdfs(created);
			await onImported(summary.createdKeys);
			(summary.failed ? toast.warning : toast.success)(summary.message);
		});

	const restart = () => {
		setReview(null);
		setResults(null);
		setAttach(new Map());
		setTopicChoice(new Map());
		setSelected(new Set());
		setCollections([]);
		setError(null);
		if (stage === "done") {
			setPdfs([]);
			setFiles([]);
			setDoiText("");
		}
	};

	const primaryLabel = { dois: action("Look up", parseDoiList(doiText).dois.length, "DOI", "DOIs"), files: action("Read", files.length, "file", "files"), pdfs: action("Read", pdfs.length, "PDF", "PDFs") }[kind];
	// The DOI box marks entries that are not DOIs itself.
	const footerProblem = stage === "input" && kind !== "dois" && (files.length || pdfs.length) ? problem : null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex h-14 shrink-0 items-center gap-4 border-b border-black/[0.06] px-6 dark:border-white/[0.06]">
				<h2 className="text-base font-semibold text-black/90 dark:text-white/90">Import records</h2>
				<span className="ms-auto">
					<ImportSteps stage={stage} />
				</span>
			</header>
			<AnimatePresence initial={false} mode="wait">
				<motion.div
					animate={{ opacity: 1 }}
					className="flex min-h-0 flex-1 flex-col"
					exit={{ opacity: 0 }}
					initial={{ opacity: 0 }}
					key={stage}
					transition={{ duration: reduceMotion ? 0 : 0.15 }}
				>
					{stage === "input" ? (
						<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
							<Tabs
								aria-label="Import from"
								classNames={{ panel: "px-0 pb-0 pt-5" }}
								isDisabled={busy}
								onSelectionChange={(key) => {
									setKind(key as ImportKind);
									setError(null);
								}}
								selectedKey={kind}
							>
								<Tab key="pdfs" title="PDFs">
									<PdfInput busy={busy} criteria={criteria} files={pdfs} onCriteriaChange={(value) => { setCriteria(value); storeCriteria(value); }} onFilesChange={setPdfs} />
								</Tab>
								<Tab key="dois" title="DOIs">
									<DoiInput busy={busy} onChange={setDoiText} text={doiText} />
								</Tab>
								<Tab key="files" title="Bibliography files">
									<BibliographyInput busy={busy} files={files} onFilesChange={setFiles} />
								</Tab>
							</Tabs>
						</div>
					) : null}
					{stage === "review" ? (
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="shrink-0 px-6 py-3">
								<ReviewBar counts={counts} filter={filter} kind={kind} onFilter={setFilter} />
							</div>
							<div className="grid min-h-0 flex-1 grid-cols-[22rem_minmax(0,1fr)] border-t border-black/[0.06] dark:border-white/[0.06]">
								<div className="min-h-0 overflow-y-auto border-e border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
									<ReviewList activeId={activeRow?.id ?? null} attach={attach} criteriaCount={criteria.length} filter={filter} locked={busy} onActivate={setActiveId} onSelectedChange={setSelected} readyIds={rows.flatMap(({ id, record }) => (record?.state === "ready" ? [id] : []))} results={results} rows={shown} selected={selected} />
								</div>
								<div className="min-h-0 overflow-y-auto px-7 py-6">
									{activeRow ? (
										<ReviewDetail
											attach={attach.get(activeRow.id)}
											chosenTopics={topicChoice.get(activeRow.id) ?? new Set()}
											criteriaCount={criteria.length}
											key={activeRow.id}
											locked={busy}
											onOpenRecord={onOpenRecord}
											onToggleTopic={(topicId) =>
												setTopicChoice((current) => {
													const next = new Set(current.get(activeRow.id));
													if (next.has(topicId)) next.delete(topicId);
													else next.add(topicId);
													return new Map(current).set(activeRow.id, next);
												})
											}
											result={resultById.get(activeRow.id)}
											row={activeRow}
										/>
									) : null}
								</div>
							</div>
						</div>
					) : null}
					{stage === "done" && results ? (
						<div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
							<ImportDone attach={attach} onOpenRecord={onOpenRecord} results={results} rows={rows} />
						</div>
					) : null}
				</motion.div>
			</AnimatePresence>
			<footer className="flex h-16 shrink-0 items-center gap-2 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
				{error || footerProblem ? (
					<p className="min-w-0 flex-1 truncate text-sm text-danger" role="alert">
						{error ?? footerProblem}
					</p>
				) : stage === "review" ? (
					<CollectionsButton collections={collections} locked={busy} onChange={setCollections} sources={sources} />
				) : null}
				<span className="ms-auto flex items-center gap-2">
					{stage === "review" ? (
						<Button isDisabled={busy} onPress={restart} size="sm" variant="transparent">
							Back
						</Button>
					) : null}
					{stage === "done" ? (
						<Button onPress={restart} size="sm" variant="transparent">
							Import more
						</Button>
					) : (
						<Button isDisabled={busy && stage === "input"} onPress={onClose} size="sm" variant="transparent">
							Cancel
						</Button>
					)}
					{stage === "input" ? (
						<Button className="min-w-28" color="accent" isDisabled={problem !== null} isLoading={busy} onPress={() => void start()} size="sm" variant="solid">
							{primaryLabel}
						</Button>
					) : null}
					{stage === "review" ? (
						<Button className="min-w-32" color="accent" isDisabled={reading || selected.size === 0} isLoading={busy && !reading} onPress={() => void commit()} size="sm" variant="solid">
							{action("Import", selected.size, "record", "records")}
						</Button>
					) : null}
					{stage === "done" ? (
						<Button className="min-w-24" color="accent" onPress={onClose} size="sm" variant="solid">
							Done
						</Button>
					) : null}
				</span>
			</footer>
		</div>
	);
}

/** Collections for the new drafts, picked in a popover so the review keeps its room. */
function CollectionsButton({ collections, locked, onChange, sources }: { collections: string[]; locked: boolean; onChange: (keys: string[]) => void; sources: readonly AdminSource[] }) {
	return (
		<Popover placement="top-start">
			<PopoverTrigger>
				<Button isDisabled={locked} size="sm" startContent={<HugeiconsIcon aria-hidden icon={Folder01Icon} size={15} />} variant="muted">
					{collections.length ? plural(collections.length, "collection", "collections") : "Add to collections"}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[24rem] p-3">
				<div className="max-h-[22rem] w-full overflow-y-auto">
					<AdminCollectionPicker
						allowedSourceKeys={editableItemCollectionSourceKeysForItems([NATIVE_SOURCE_CONNECTION_KEY], sources)}
						onSelectionChange={onChange}
						selectedKeys={collections}
						selectionMode="multiple"
						sources={sources}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
