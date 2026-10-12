"use client";

import { Folder01Icon } from "@hugeicons/core-free-icons";
import { ModalContent, Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, use, useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import { estimatePdfImportCost, parseDoiList, type AdminImportCommitResult } from "@/lib/admin/item-import-contract";
import type { AdminSource } from "@/lib/admin/types";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import { ImportDone } from "./ImportDone";
import { BibliographyInput, DoiInput, PdfInput } from "./ImportInputs";
import { ReviewBar, ReviewDetail, ReviewList, usd } from "./ImportReview";
import { ImportSteps, type ImportKind, type ImportStage } from "./ImportSteps";
import { AdminApiError, commitAdminImport, createAdminDraft, previewAdminImport, readAdminImportPdf } from "./admin-api";
import {
	changeImportBatch,
	changeImportRow,
	chosenTopics,
	doiPreviewRequest,
	endImportBatch,
	filePreviewRequest,
	pendingPdfRows,
	publishedProperties,
	publishImported,
	readPdfs,
	readyIds,
	recordRights,
	reviewChecks,
	reviewCounts,
	reviewMatches,
	rowsFromRecords,
	selectedIds,
	selectedImportRecords,
	startImportBatch,
	storeChecks,
	storedChecks,
	storeReview,
	summarizeImportResults,
	useImportBatch,
	validateChecks,
	validateImportFiles,
	validatePdfFiles,
	type AttachState,
	type ImportCheck,
	type ImportRow,
	type ReviewFilter,
} from "./admin-import";
import { uploadPdfFile } from "./admin-pdf";
import { pdfPageCount } from "./pdf-thumbnail";

function errorMessage(error: unknown) {
	if (error instanceof AdminApiError) {
		const fieldMessages = Object.values(error.fields);
		return fieldMessages.length ? `${error.message} ${fieldMessages.join(" ")}` : error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function inputError(kind: ImportKind, doiText: string, files: readonly File[], pdfs: readonly File[], checks: readonly ImportCheck[]) {
	try {
		if (kind === "dois") doiPreviewRequest(doiText);
		else if (kind === "files") validateImportFiles(files);
		else {
			validatePdfFiles(pdfs);
			validateChecks(checks);
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

const pageTotals = new WeakMap<readonly File[], Promise<number | null>>();

/** The chosen PDFs' pages added up, once per selection. Null when one can't be opened. */
function pagesIn(files: readonly File[]) {
	let total = pageTotals.get(files);
	if (!total) {
		total = Promise.all(files.map(pdfPageCount)).then((counts) => (counts.includes(null) ? null : counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)));
		pageTotals.set(files, total);
	}
	return total;
}

function CostEstimate({ files, stale }: { files: readonly File[]; stale: boolean }) {
	const pages = use(pagesIn(files));
	if (pages === null) return null;
	return (
		<p className={`animate-fade-in text-xs tabular-nums text-black/50 transition-opacity duration-200 [animation-duration:300ms] dark:text-white/50 ${stale ? "opacity-50" : ""}`}>
			About {usd(estimatePdfImportCost(pages, files.length))} for {pages} pages
		</p>
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
	const batch = useImportBatch();
	const [kind, setKind] = useState<ImportKind>(batch?.kind ?? "pdfs");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [pdfs, setPdfs] = useState<File[]>([]);
	const estimateFiles = useDeferredValue(pdfs);
	const [checks, setChecks] = useState(storedChecks);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [filter, setFilter] = useState<ReviewFilter>("all");
	const [collections, setCollections] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const stage: ImportStage = batch?.results ? "done" : batch ? "review" : "input";
	const problem = inputError(kind, doiText, files, pdfs, checks);
	const rows = batch?.rows ?? [];
	const counts = reviewCounts(rows);
	const reading = batch?.kind === "pdfs" && counts.done < counts.total;
	const shown = rows.filter((row) => reviewMatches(row, filter));
	const activeRow = rows.find(({ id }) => id === activeId) ?? shown[0] ?? null;
	const resultById = new Map((batch?.results ?? []).map((result) => [result.id, result]));
	const selected = batch ? selectedIds(batch) : new Set<string>();
	const checksOf = (row: ImportRow) => reviewChecks(row, batch?.checks ?? []);
	const topicsOf = (row: ImportRow) => (batch ? chosenTopics(batch, row) : new Set<string>());
	const topicNames = (row: ImportRow) => row.topics.filter(({ id }) => topicsOf(row).has(id)).map(({ name }) => name);
	const propertiesOf = (row: ImportRow) => publishedProperties(row, batch?.checks ?? [], topicNames(row), batch?.publish.get(row.id)?.doi ?? null);

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

	const start = () =>
		run(async () => {
			setFilter("all");
			const importId = crypto.randomUUID();
			if (kind === "pdfs") {
				storeChecks(checks);
				const pending = pendingPdfRows(pdfs);
				setActiveId(pending[0]?.id ?? null);
				startImportBatch({ checks, importId, kind, rows: pending });
				const texts = checks.map(({ text }) => text);
				void readPdfs(importId, pending, (file) => readAdminImportPdf(file, texts), errorMessage);
				return;
			}
			const response = await previewAdminImport(kind === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest(files));
			const previewRows = rowsFromRecords(response.records);
			setActiveId(previewRows[0]?.id ?? null);
			startImportBatch({ checks: [], importId, kind, rows: previewRows });
		});

	const attachPdfs = async (importId: string, created: AdminImportCommitResult[]) => {
		const rowById = new Map(rows.map((row) => [row.id, row]));
		const mark = (id: string, state: AttachState) => changeImportBatch(importId, (current) => ({ ...current, attach: new Map(current.attach).set(id, state) }));
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
			if (!batch) return;
			const rowById = new Map(rows.map((row) => [row.id, row]));
			const records = selectedImportRecords(
				rows.flatMap(({ record }) => (record ? [record] : [])),
				selected,
			).map((record) => {
				const row = rowById.get(record.id)!;
				const topics = [...topicsOf(row)];
				const rights = recordRights(row, batch.checks);
				return { ...record, payload: { ...record.payload, ...(topicsEnabled && topics.length ? { topics } : {}), ...(rights ? { rights } : {}) } };
			});
			const response = await commitAdminImport({ collections, importId: batch.importId, records });
			changeImportBatch(batch.importId, (current) => ({ ...current, results: response.results }));
			const created = response.results.filter(({ itemKey, outcome }) => outcome === "created" && itemKey);
			for (const { id, itemKey } of created) {
				const row = rowById.get(id)!;
				storeReview(itemKey!, { abstractWritten: row.abstractWritten, checks: checksOf(row), topics: row.topics.filter((topic) => topicsOf(row).has(topic.id)) });
			}
			const summary = summarizeImportResults(response.results);
			if (batch.kind === "pdfs") void attachPdfs(batch.importId, created);
			await onImported(summary.createdKeys);
			(summary.failed ? toast.warning : toast.success)(summary.message);
		});

	const restart = () => {
		endImportBatch();
		setCollections([]);
		setError(null);
		if (stage === "done") {
			setPdfs([]);
			setFiles([]);
			setDoiText("");
		}
	};

	const finish = () => {
		endImportBatch();
		onClose();
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
									<PdfInput
										busy={busy}
										checks={checks}
										files={pdfs}
										onChecksChange={(value) => {
											setChecks(value);
											storeChecks(value);
										}}
										onFilesChange={setPdfs}
									/>
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
					{stage === "review" && batch ? (
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="shrink-0 px-6 py-3">
								<ReviewBar costUsd={rows.reduce((sum, row) => sum + row.costUsd, 0)} counts={counts} filter={filter} kind={batch.kind} onFilter={setFilter} />
							</div>
							<div className="grid min-h-0 flex-1 grid-cols-[22rem_minmax(0,1fr)] border-t border-black/[0.06] dark:border-white/[0.06]">
								<div className="min-h-0 overflow-y-auto border-e border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
									<ReviewList
										activeId={activeRow?.id ?? null}
										attach={batch.attach}
										checksOf={checksOf}
										criteriaCount={batch.checks.length}
										filter={filter}
										locked={busy}
										onActivate={setActiveId}
										onSelectedChange={(next) => changeImportBatch(batch.importId, (current) => ({ ...current, excluded: new Set(readyIds(current.rows).filter((id) => !next.has(id))) }))}
										readyIds={readyIds(rows)}
										results={batch.results}
										rows={shown}
										selected={selected}
									/>
								</div>
								<div className="min-h-0 overflow-y-auto px-7 py-6">
									{activeRow ? (
										<ReviewDetail
											attach={batch.attach.get(activeRow.id)}
											checks={checksOf(activeRow)}
											chosenTopics={topicsOf(activeRow)}
											criteriaCount={batch.checks.length}
											key={activeRow.id}
											locked={busy}
											onFix={(index) => changeImportRow(batch.importId, activeRow.id, (row) => ({ ...row, fixed: row.fixed.includes(index) ? row.fixed.filter((other) => other !== index) : [...row.fixed, index] }))}
											onOpenRecord={onOpenRecord}
											onToggleTopic={(topicId) =>
												changeImportBatch(batch.importId, (current) => {
													const next = new Set(chosenTopics(current, activeRow));
													if (next.has(topicId)) next.delete(topicId);
													else next.add(topicId);
													return { ...current, topics: new Map(current.topics).set(activeRow.id, next) };
												})
											}
											properties={propertiesOf(activeRow)}
											result={resultById.get(activeRow.id)}
											row={activeRow}
										/>
									) : null}
								</div>
							</div>
						</div>
					) : null}
					{stage === "done" && batch?.results ? (
						<div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
							<ImportDone batch={batch} onOpenRecord={onOpenRecord} onPublish={(ids) => void publishImported(batch.importId, ids)} />
						</div>
					) : null}
				</motion.div>
			</AnimatePresence>
			<footer className="flex h-16 shrink-0 items-center gap-3 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
				{error || footerProblem ? (
					<p className="min-w-0 flex-1 truncate text-sm text-danger" role="alert">
						{error ?? footerProblem}
					</p>
				) : stage === "review" ? (
					<>
						<CollectionsButton collections={collections} locked={busy} onChange={setCollections} sources={sources} />
						{reading ? <p className="text-xs text-black/50 dark:text-white/50">Reading carries on if you close this</p> : null}
					</>
				) : stage === "input" && kind === "pdfs" && estimateFiles.length ? (
					<Suspense fallback={null}>
						<CostEstimate files={estimateFiles} stale={estimateFiles !== pdfs} />
					</Suspense>
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
							{stage === "review" ? "Close" : "Cancel"}
						</Button>
					)}
					{stage === "input" ? (
						<Button className="min-w-28" color="accent" isDisabled={problem !== null} isLoading={busy} onPress={() => void start()} size="sm" variant="solid">
							{primaryLabel}
						</Button>
					) : null}
					{stage === "review" ? (
						<Button className="min-w-32" color="accent" isDisabled={reading || selected.size === 0} isLoading={busy} onPress={() => void commit()} size="sm" variant="solid">
							{action("Import", selected.size, "record", "records")}
						</Button>
					) : null}
					{stage === "done" ? (
						<Button className="min-w-24" color="accent" onPress={finish} size="sm" variant="solid">
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
