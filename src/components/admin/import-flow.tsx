"use client";

import { Folder01Icon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { use, useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import { estimatePdfImportCost, parseDoiList, type AdminImportCommitResult } from "@/lib/admin/item-import-contract";
import type { AdminSource } from "@/lib/admin/types";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import { usd } from "./ImportReview";
import type { ImportKind, ImportStage } from "./ImportSteps";
import { AdminApiError, commitAdminImport, createAdminDraft, previewAdminImport, readAdminImportPdf } from "./admin-api";
import {
	FILE_CHECKS,
	changeImportBatch,
	changeImportRow,
	chosenTopics,
	currentImportBatch,
	doiPreviewRequest,
	endImportBatch,
	filePreviewRequest,
	pendingPdfRows,
	publishImported,
	publishedProperties,
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
	storedGuidance,
	storeGuidance,
	storeReview,
	summarizeImportResults,
	useImportBatch,
	validateChecks,
	validateGuidance,
	validateImportFiles,
	validatePdfFiles,
	type AttachState,
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

function inputError(kind: ImportKind, doiText: string, files: readonly File[], pdfs: readonly File[], checks: readonly string[], guidance: string) {
	try {
		if (kind === "dois") doiPreviewRequest(doiText);
		else if (kind === "files") validateImportFiles(files);
		else {
			validatePdfFiles(pdfs);
			validateChecks(checks);
			validateGuidance(guidance);
		}
		return null;
	} catch (error) {
		return errorMessage(error);
	}
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "Read 5 PDFs", or "Read PDFs" before there are any. */
export const action = (verb: string, count: number, one: string, many: string) => (count ? `${verb} ${plural(count, one, many)}` : `${verb} ${many}`);

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

/** What reading the chosen PDFs should cost. Render inside Suspense. */
export function CostEstimate({ files, stale }: { files: readonly File[]; stale: boolean }) {
	const pages = use(pagesIn(files));
	if (pages === null) return null;
	const cost = estimatePdfImportCost(pages, files.length);
	return (
		<span className="min-w-0 animate-fade-in truncate [animation-duration:300ms]">
			<span className={`transition-opacity duration-200 ${stale ? "opacity-50" : ""}`}>
				{cost < 0.01 ? "Under $0.01" : `About ${usd(cost)}`} for {plural(pages, "page", "pages")}
			</span>
		</span>
	);
}

/** Collections for the new drafts, picked in a popover so the review keeps its room. */
export function CollectionsButton({ collections, locked, onChange, sources }: { collections: string[]; locked: boolean; onChange: (keys: string[]) => void; sources: readonly AdminSource[] }) {
	return (
		<Popover placement="top-start">
			<PopoverTrigger>
				<Button isDisabled={locked} size="sm" startContent={<HugeiconsIcon aria-hidden icon={Folder01Icon} size={15} />} variant="muted">
					{collections.length ? plural(collections.length, "collection", "collections") : "Add to collections"}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[24rem] p-3">
				<div className="max-h-[22rem] w-full overflow-y-auto [scrollbar-gutter:stable]">
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

export type ImportFlowProps = {
	onClose: () => void;
	onImported: (itemKeys: string[]) => Promise<void> | void;
	onOpenRecord: (itemKey: string) => void;
	sources: readonly AdminSource[];
};

/**
 * Everything the Import dialog knows and does, whatever it looks like: the
 * source and what was added, the batch being reviewed, and the steps from
 * reading to importing and publishing. Every design draws from this one.
 */
export function useImportFlow({ onClose, onImported, onOpenRecord, sources }: ImportFlowProps) {
	const topicsEnabled = useLibraryConfig().topics.enabled;
	const batch = useImportBatch();
	const [kind, setKindState] = useState<ImportKind>(batch?.kind ?? "pdfs");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [pdfs, setPdfs] = useState<File[]>([]);
	const estimateFiles = useDeferredValue(pdfs);
	const [checks, setChecksState] = useState(() => (typeof window === "undefined" ? [] : storedChecks()));
	// A list, so a row emptied while it is being edited stays until it loses focus.
	const [instructions, setInstructionsState] = useState<string[]>(() => (typeof window === "undefined" ? [] : storedGuidance().split("\n").filter((line) => line.trim())));
	const guidance = instructions.map((line) => line.trim()).filter(Boolean).join("\n");
	// Chosen before reading starts; the batch carries them from then on.
	const [collections, setCollectionsState] = useState<string[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [filter, setFilter] = useState<ReviewFilter>("all");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const stage: ImportStage = batch?.results ? "done" : batch ? "review" : "input";
	const problem = inputError(kind, doiText, files, pdfs, checks, guidance);
	const rows = batch?.rows ?? [];
	const counts = reviewCounts(rows);
	const reading = batch?.kind === "pdfs" && counts.done < counts.total;
	const locked = busy || batch?.committing === true;
	const shown = rows.filter((row) => reviewMatches(row, filter));
	const activeRow = rows.find(({ id }) => id === activeId) ?? shown[0] ?? null;
	const resultById = new Map((batch?.results ?? []).map((result) => [result.id, result]));
	const selected = batch ? selectedIds(batch) : new Set<string>();
	const checksOf = (row: ImportRow) => reviewChecks(row);
	// The library's checks, and for PDFs the ones read from the file.
	const checkCount = (batch?.checks.length ?? 0) + (batch?.kind === "pdfs" ? FILE_CHECKS.length : 0);
	const topicsOf = (row: ImportRow) => (batch ? chosenTopics(batch, row) : new Set<string>());
	const topicNames = (row: ImportRow) => row.topics.filter(({ id }) => topicsOf(row).has(id)).map(({ name }) => name);
	const propertiesOf = (row: ImportRow) => publishedProperties(row, topicNames(row), batch?.publish.get(row.id)?.doi ?? null);

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
				startImportBatch({ checks, collections, importId, kind, rows: pending });
				void readPdfs(importId, pending, (file) => readAdminImportPdf(file, checks, guidance), errorMessage);
				return;
			}
			const response = await previewAdminImport(kind === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest(files));
			// The dialog may have closed and started another import while this lookup ran.
			if (currentImportBatch()) return;
			const previewRows = rowsFromRecords(response.records);
			setActiveId(previewRows[0]?.id ?? null);
			startImportBatch({ checks: [], collections, importId, kind, rows: previewRows });
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
				const rights = recordRights(row);
				return { ...record, payload: { ...record.payload, ...(topicsEnabled && topics.length ? { topics } : {}), ...(rights ? { rights } : {}) } };
			});
			changeImportBatch(batch.importId, (current) => ({ ...current, committing: true }));
			const response = await commitAdminImport({ collections: batch.collections, importId: batch.importId, records }).catch((caught: unknown) => {
				changeImportBatch(batch.importId, (current) => ({ ...current, committing: false }));
				throw caught;
			});
			changeImportBatch(batch.importId, (current) => ({ ...current, committing: false, results: response.results }));
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

	const importId = batch?.importId ?? "";
	return {
		activeRow,
		batch,
		busy,
		checkCount,
		checks,
		checksOf,
		collections: batch?.collections ?? collections,
		commit: () => void commit(),
		counts,
		doiText,
		error,
		estimateFiles,
		files,
		filter,
		finish,
		guidance,
		instructions,
		// The DOI box lists entries that are not DOIs itself; the footer explains the rest, such as too many DOIs.
		footerProblem: stage === "input" && (kind === "pdfs" ? pdfs.length : kind === "files" ? files.length : doiText.trim() && !parseDoiList(doiText).invalid.length) ? problem : null,
		kind,
		locked,
		onClose,
		onOpenRecord,
		pdfs,
		primaryLabel: { dois: action("Look up", parseDoiList(doiText).dois.length, "DOI", "DOIs"), files: action("Read", files.length, "file", "files"), pdfs: action("Read", pdfs.length, "PDF", "PDFs") }[kind],
		problem,
		propertiesOf,
		reading,
		restart,
		resultById,
		rows,
		selected,
		shown,
		sources,
		stage,
		start: () => void start(),
		topicsOf,
		costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
		readyIds: readyIds(rows),
		setActiveId,
		setChecks: (value: string[]) => {
			setChecksState(value);
			storeChecks(value);
		},
		setCollections: (keys: string[]) => (batch ? changeImportBatch(importId, (current) => ({ ...current, collections: keys })) : setCollectionsState(keys)),
		setDoiText,
		setFiles,
		setInstructions: (items: string[]) => {
			setInstructionsState(items);
			storeGuidance(items.join("\n"));
		},
		setFilter,
		setKind: (value: ImportKind) => {
			setKindState(value);
			setError(null);
		},
		setPdfs,
		/** Ready records not in `next` stay out of the import. */
		setSelected: (next: ReadonlySet<string>) => changeImportBatch(importId, (current) => ({ ...current, excluded: new Set(readyIds(current.rows).filter((id) => !next.has(id))) })),
		choosePublish: (ids: ReadonlySet<string>) => changeImportBatch(importId, (current) => ({ ...current, toPublish: ids })),
		publish: (ids: string[]) => void publishImported(importId, ids),
		setFix: (rowId: string, applied: boolean) => changeImportRow(importId, rowId, (row) => ({ ...row, fixApplied: applied })),
		toggleFix: (rowId: string) => changeImportRow(importId, rowId, (row) => ({ ...row, fixApplied: !row.fixApplied })),
		toggleTopic: (rowId: string, topicId: string) =>
			changeImportBatch(importId, (current) => {
				const row = current.rows.find(({ id }) => id === rowId);
				if (!row) return current;
				const next = new Set(chosenTopics(current, row));
				if (next.has(topicId)) next.delete(topicId);
				else next.add(topicId);
				return { ...current, topics: new Map(current.topics).set(rowId, next) };
			}),
	};
}

export type ImportFlowState = ReturnType<typeof useImportFlow>;
