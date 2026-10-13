"use client";

import { useState } from "react";
import { mutate } from "swr";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { parseDoiList } from "@/lib/admin/item-import-contract";
import type { PublishingChoice } from "@/lib/admin/review-contract";
import type { AdminSource } from "@/lib/admin/types";

import type { ImportKind, ImportStage } from "./ImportSteps";
import {
	AdminApiError,
	approveAdminReview,
	closeAdminPdfImport,
	commitAdminImport,
	commitAdminPdfImport,
	failAdminPdfImportUpload,
	PDF_IMPORT_KEY,
	previewAdminImport,
	reserveAdminCrossrefDoi,
	saveAdminPublishingChoice,
	startAdminPdfImport,
	submitAdminReview,
	uploadAdminPdfImportFile,
} from "./admin-api";
import {
	appliedOf,
	changeImportBatch,
	chosenTopics,
	createdKeys,
	currentImportBatch,
	doiPreviewRequest,
	endImportBatch,
	filePreviewRequest,
	publishedProperties,
	readyIds,
	recordPayload,
	reviewChecks,
	reviewCounts,
	reviewMatches,
	rowsFromRecords,
	selectedIds,
	selectedImportRecords,
	startImportBatch,
	useImportBatch,
	usePdfImportStatus,
	validateChecks,
	validateGuidance,
	validateImportFiles,
	validatePdfFiles,
	type ImportRow,
	type PublishState,
	type ReviewFilter,
} from "./admin-import";

function errorMessage(error: unknown) {
	if (error instanceof AdminApiError) {
		const fieldMessages = Object.values(error.fields);
		return fieldMessages.length ? `${error.message} ${fieldMessages.join(" ")}` : error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** What a draft lacks to be submitted, such as a publisher for Crossref, rather than the request's summary. */
function publishError(error: unknown) {
	const missing = error instanceof AdminApiError ? Object.values(error.fields).map((text) => text.replace(/\.$/u, "")) : [];
	return missing.length ? `${missing.join(". ")}.` : errorMessage(error);
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

// Each draft is submitted and may be approved and reindexed, so a few at a time.
const SEND_CONCURRENCY = 2;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "Read 5 PDFs", or "Read PDFs" before there are any. */
export const action = (verb: string, count: number, one: string, many: string) => (count ? `${verb} ${plural(count, one, many)}` : `${verb} ${many}`);

// PDFs sent to the server at once while an import starts.
const UPLOAD_CONCURRENCY = 3;

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
	const last = usePdfImportStatus().data?.last;
	const [kind, setKindState] = useState<ImportKind>(batch?.kind ?? "pdfs");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [pdfs, setPdfs] = useState<File[]>([]);
	// The library's last import's checks and instructions until the editor changes them here.
	const [editedChecks, setEditedChecks] = useState<string[] | null>(null);
	const checks = editedChecks ?? last?.checks ?? [];
	// A list, so a row emptied while it is being edited stays until it loses focus.
	const [editedInstructions, setEditedInstructions] = useState<string[] | null>(null);
	const instructions = editedInstructions ?? (last?.instructions ?? "").split("\n").filter((line) => line.trim());
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
	const counts = reviewCounts(batch);
	const reading = batch?.kind === "pdfs" && counts.done < counts.total;
	const locked = busy || batch?.committing === true;
	const shown = rows.filter((row) => reviewMatches(batch, row, filter));
	const activeRow = rows.find(({ id }) => id === activeId) ?? shown[0] ?? null;
	const resultById = new Map((batch?.results ?? []).map((result) => [result.id, result]));
	const selected = batch ? selectedIds(batch) : new Set<string>();
	const appliedFor = (row: ImportRow) => appliedOf(batch, row);
	const checksOf = (row: ImportRow) => reviewChecks(row, appliedFor(row));
	const checkCount = batch?.checks.length ?? 0;
	const topicsOf = (row: ImportRow) => (batch ? chosenTopics(batch, row) : new Set<string>());
	const topicNames = (row: ImportRow) => row.topics.filter(({ id }) => topicsOf(row).has(id)).map(({ name }) => name);
	const propertiesOf = (row: ImportRow) => publishedProperties(row, appliedFor(row), topicNames(row));

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
			if (kind === "pdfs") {
				// The import and its rows exist on the server first, so the review shows every PDF while they upload.
				const started = await startAdminPdfImport({ checks, collections, filenames: pdfs.map(({ name }) => name), instructions: guidance });
				await mutate(PDF_IMPORT_KEY);
				void uploadPdfs(started.files.map(({ id }, index) => ({ file: pdfs[index]!, id })));
				return;
			}
			const importId = crypto.randomUUID();
			const response = await previewAdminImport(kind === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest(files));
			// The dialog may have closed and started another import while this lookup ran.
			if (currentImportBatch()) return;
			const previewRows = rowsFromRecords(response.records);
			setActiveId(previewRows[0]?.id ?? null);
			startImportBatch({ checks: [], collections, importId, kind, rows: previewRows });
		});

	/** Sends the PDFs to the server a few at a time; the worker reads each as it arrives. */
	const uploadPdfs = async (queue: { file: File; id: string }[]) => {
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
				while (next < queue.length) {
					const { file, id } = queue[next++]!;
					try {
						await uploadAdminPdfImportFile(id, file);
					} catch (caught) {
						// The import goes ahead without it; its row says why.
						await failAdminPdfImportUpload(id, errorMessage(caught)).catch(() => undefined);
					}
					void mutate(PDF_IMPORT_KEY);
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
				return { ...record, payload: { ...recordPayload(row, appliedFor(row)), ...(topicsEnabled && topics.length ? { topics } : {}) } };
			});
			const input = { collections: batch.collections, importId: batch.importId, records };
			changeImportBatch(batch.importId, (current) => ({ ...current, committing: true }));
			try {
				// A PDF import is kept on the server, which gives each new draft its PDF.
				if (batch.kind === "pdfs") {
					const { results } = await commitAdminPdfImport(input);
					await mutate(PDF_IMPORT_KEY);
					await onImported(createdKeys(results));
				} else {
					const { results } = await commitAdminImport(input);
					changeImportBatch(batch.importId, (current) => ({ ...current, results }));
					// The finish step says what the import did, so no toast covers its buttons.
					await onImported(createdKeys(results));
				}
			} finally {
				changeImportBatch(batch.importId, (current) => ({ ...current, committing: false }));
			}
		});

	/**
	 * Sends drafts on the way the record inspector does. A draft made from a
	 * PDF takes the import's DOI route, and on Crossref its DOI is reserved;
	 * then the draft is submitted for review. Editors and owners approve it
	 * at once, which publishes it, and the publication worker activates the
	 * DOI; anyone else leaves it for an editor.
	 */
	const send = async (importId: string, drafts: readonly { id: string; itemKey: string; kind: "created" | "imported" | undefined }[], approve: boolean) => {
		const route = batch?.publishRoute ?? "zenodo";
		const created = createdKeys(batch?.results ?? []);
		const mark = (id: string, state: PublishState) => changeImportBatch(importId, (current) => ({ ...current, publish: new Map(current.publish).set(id, state) }));
		for (const { id } of drafts) mark(id, { state: "sending" });
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(SEND_CONCURRENCY, drafts.length) }, async () => {
				while (next < drafts.length) {
					const { id, itemKey, kind } = drafts[next++]!;
					try {
						let doi: string | undefined;
						if (kind === "created") {
							await saveAdminPublishingChoice(itemKey, route === "zenodo" ? { identifierPolicy: "mint-zenodo", route } : { identifierPolicy: "reuse-crossref", route });
							if (route === "crossref-zenodo") doi = (await reserveAdminCrossrefDoi(itemKey)).doi;
						}
						const review = await submitAdminReview(itemKey);
						if (approve) await approveAdminReview(review.id, review.revision);
						mark(id, approve ? { state: "published" } : { doi, state: "submitted" });
					} catch (caught) {
						console.error("Sending the draft on failed", itemKey, caught);
						mark(id, { message: publishError(caught), state: "failed" });
					}
				}
			}),
		);
		// The table shows their new state; the import's drafts stay the selection.
		await onImported(created);
	};

	/** Ends the import here and, for a PDF import, on the server, which removes its stored PDFs. */
	const end = async () => {
		if (batch?.kind === "pdfs") {
			await closeAdminPdfImport(batch.importId);
			await mutate(PDF_IMPORT_KEY);
		}
		endImportBatch();
	};

	const restart = () =>
		run(async () => {
			await end();
			if (stage === "done") {
				setPdfs([]);
				setFiles([]);
				setDoiText("");
			}
		});

	const finish = () =>
		run(async () => {
			await end();
			onClose();
		});

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
		files,
		filter,
		finish: () => void finish(),
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
		restart: () => void restart(),
		resultById,
		rows,
		selected,
		shown,
		sources,
		stage,
		start: () => void start(),
		topicsOf,
		readyIds: readyIds(rows),
		setActiveId,
		setChecks: setEditedChecks,
		setCollections: (keys: string[]) => (batch ? changeImportBatch(importId, (current) => ({ ...current, collections: keys })) : setCollectionsState(keys)),
		setDoiText,
		setFiles,
		setInstructions: setEditedInstructions,
		setFilter,
		setKind: (value: ImportKind) => {
			setKindState(value);
			setError(null);
		},
		setPdfs,
		/** Ready records not in `next` stay out of the import. */
		setSelected: (next: ReadonlySet<string>) => changeImportBatch(importId, (current) => ({ ...current, excluded: new Set(readyIds(current.rows).filter((id) => !next.has(id))) })),
		choosePublish: (ids: ReadonlySet<string>) => changeImportBatch(importId, (current) => ({ ...current, toPublish: ids })),
		/** Publishes the drafts when `approve` (editors and owners), else submits them for review. */
		send: (drafts: Parameters<typeof send>[1], approve: boolean) => void send(importId, drafts, approve),
		setPublishRoute: (route: PublishingChoice["route"]) => changeImportBatch(importId, (current) => ({ ...current, publishRoute: route })),
		appliedFor,
		toggleSuggestion: (rowId: string, index: number) =>
			changeImportBatch(importId, (current) => {
				const row = current.rows.find(({ id }) => id === rowId);
				if (!row) return current;
				const next = new Set(appliedOf(current, row));
				if (next.has(index)) next.delete(index);
				else next.add(index);
				return { ...current, applied: new Map(current.applied).set(rowId, next) };
			}),
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
