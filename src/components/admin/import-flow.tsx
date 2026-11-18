"use client";

import { useState } from "react";
import { mutate } from "swr";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import type { AdminPdfImport } from "@/lib/admin/item-import-contract";
import { routeChoice, type PublishingChoice } from "@/lib/admin/review-contract";
import type { AdminSource } from "@/lib/admin/types";
import type { RecordLicence } from "@/lib/licences";

import type { ImportKind, ImportStage } from "./ImportSteps";
import { useAdminSession } from "./AdminSessionProvider";
import {
	AdminApiError,
	approveAdminReview,
	closeAdminPdfImport,
	commitAdminImport,
	commitAdminPdfImport,
	failAdminPdfImportUpload,
	getAdminPdfImport,
	PDF_IMPORT_KEY,
	previewAdminImport,
	reserveAdminCrossrefDoi,
	saveAdminPublishingChoice,
	startAdminPdfImport,
	submitAdminReview,
	uploadAdminPdfImportFile,
} from "./admin-api";
import {
	addStep,
	appliedOf,
	batchFields,
	changeImportBatch,
	chosenOf,
	createdKeys,
	doiPreviewRequest,
	draftNeeds,
	dropLookup,
	endImportBatch,
	errorMessage,
	filePreviewRequest,
	lookupStands,
	needsText,
	primaryLabel,
	publishedProperties,
	readingNeeds,
	reviewRoute,
	licenceOf,
	readyIds,
	recordsToCommit,
	reviewChecks,
	reviewProgress,
	reviewRows,
	routeOf,
	rowsFromRecords,
	sendPdfUploads,
	shownImport,
	stageOf,
	startImportBatch,
	startingChecks,
	startingInstructions,
	startLookup,
	useImportBatches,
	usePdfImportStatus,
	withChoiceToggled,
	withSuggestionToggled,
	type ChoiceKind,
	type ImportBatch,
	type ImportOutcome,
	type ImportRow,
	type PublishState,
	type ReviewFilter,
} from "./admin-import";

/** What a draft lacks to be submitted, such as a publisher for Crossref, rather than the request's summary. */
function publishError(error: unknown) {
	return error instanceof AdminApiError && Object.keys(error.fields).length ? needsText(error.fields) : errorMessage(error);
}

// Each draft is submitted and may be approved and reindexed, so a few at a time.
const SEND_CONCURRENCY = 2;

// PDFs sent to the server at once while an import starts.
const UPLOAD_CONCURRENCY = 3;

/** Runs `work` on every item, a few at a time. */
async function inTurn<Item>(items: readonly Item[], concurrency: number, work: (item: Item) => Promise<void>) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (next < items.length) await work(items[next++]!);
		}),
	);
}

type PdfUpload = { file: File; id: string; signedUrl: string };

/** Sends one PDF to storage; the worker reads it once it arrives. One that can't be sent goes ahead without it, its row saying why. */
async function uploadPdf({ file, id, signedUrl }: PdfUpload) {
	try {
		await uploadAdminPdfImportFile(id, signedUrl, file);
	} catch (caught) {
		await failAdminPdfImportUpload(id, errorMessage(caught)).catch(() => undefined);
	}
	void mutate(PDF_IMPORT_KEY);
}

/** Opens the library's PDF import. The import and its rows exist on the server first, so the review shows every PDF while they upload. */
async function startPdfImport(input: { checks: readonly string[]; collections: string[]; guidance: string; pdfs: readonly File[] }) {
	const started = await startAdminPdfImport({ checks: [...input.checks], collections: input.collections, files: input.pdfs.map(({ name, size }) => ({ name, size })), instructions: input.guidance });
	await mutate(PDF_IMPORT_KEY);
	const uploads = started.files.map(({ id, upload }, index) => ({ file: input.pdfs[index]!, id, signedUrl: upload.signedUrl }));
	void sendPdfUploads(started.id, started.files.map(({ id }) => id), () => inTurn(uploads, UPLOAD_CONCURRENCY, uploadPdf));
}

/** Looks up DOIs or reads bibliography files into a review; null when the sheet closed while it ran. */
async function lookUp(kind: Exclude<ImportKind, "pdfs">, doiText: string, files: readonly File[]) {
	const token = startLookup();
	const response = await previewAdminImport(kind === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest([...files]));
	if (!lookupStands(token)) return null;
	dropLookup();
	return rowsFromRecords(response.records);
}

/** Opens a DOI or bibliography import in this tab with what the lookup found, its first record open. */
async function startLookupImport(inputs: { collections: string[]; doiText: string; files: readonly File[]; kind: Exclude<ImportKind, "pdfs"> }, openRow: (id: string | null) => void) {
	const rows = await lookUp(inputs.kind, inputs.doiText, inputs.files);
	if (!rows) return;
	openRow(rows[0]?.id ?? null);
	startImportBatch({ checks: [], collections: inputs.collections, importId: crypto.randomUUID(), kind: inputs.kind, rows });
}

/** Imports the chosen records as drafts. A PDF import is kept on the server, which gives each new draft its PDF. */
/** Sent on, the server publishes or submits each draft of a PDF import as its PDF is attached, so closing the tab doesn't stop it. */
const sendOf = (batch: ImportBatch, publish: boolean) => (batch.kind === "pdfs" && batch.outcome === "send" ? { route: batch.publishRoute, publish } : null);

async function commitBatch(batch: ImportBatch, topicsEnabled: boolean, onImported: ImportFlowProps["onImported"], publish: boolean) {
	const input = { collections: batch.collections, importId: batch.importId, records: recordsToCommit(batch, topicsEnabled), send: sendOf(batch, publish) };
	changeImportBatch(batch, (current) => ({ ...current, committing: true }));
	try {
		const { results } = batch.kind === "pdfs" ? await commitAdminPdfImport(input) : await commitAdminImport(input);
		if (batch.kind === "pdfs") await mutate(PDF_IMPORT_KEY);
		else changeImportBatch(batch, (current) => ({ ...current, results }));
		// The finish step says what the import did, so no toast covers its buttons.
		await onImported(createdKeys(results));
	} finally {
		changeImportBatch(batch, (current) => ({ ...current, committing: false }));
	}
}

type SentDraft = { id: string; itemKey: string; kind: "created" | "imported" | undefined };

/**
 * Gives a draft made in the library the import's DOI route, or none when it
 * is switched off, replacing any an earlier send saved before it failed; on
 * Crossref its DOI is reserved now, and returned.
 */
async function chooseDoiRoute(itemKey: string, route: PublishingChoice["route"] | null) {
	await saveAdminPublishingChoice(itemKey, routeChoice(route));
	return route === "crossref-zenodo" ? (await reserveAdminCrossrefDoi(itemKey)).doi : undefined;
}

type PendingReview = ImportBatch["reviews"][string];
type SentNow = Pick<AdminPdfImport, "needs" | "reviews" | "sent">;

/**
 * The import's pending reviews, sent drafts and what the rest need now, not as
 * this browser last saw them: an editor may have withdrawn a review in the record
 * since, an approval gone through whose answer was lost, or an edit just saved
 * removed a field publishing needs. When another tab closed or replaced the
 * import, nothing is known of its drafts, so nothing is sent.
 */
async function sentNow(importId: string): Promise<SentNow> {
	const current = (await getAdminPdfImport()).import;
	if (current?.id !== importId) throw new Error("This import was closed in another tab.");
	return current;
}

/** A send that submitted a draft's review but couldn't approve it, with that review. */
class NotApprovedError extends Error {
	constructor(
		readonly review: PendingReview,
		readonly reason: unknown,
	) {
		super("The review was submitted but not approved.");
	}
}

/** Approves a submitted review, which publishes the draft. */
async function approve(review: PendingReview) {
	try {
		await approveAdminReview(review.id, review.revision);
	} catch (caught) {
		throw new NotApprovedError(review, caught);
	}
	return { state: "published" as const };
}

/** A draft whose review is still pending: an editor or owner approves it, and anyone else leaves it waiting. */
const sendPending = async (pending: PendingReview, canApprove: boolean): Promise<PublishState> => (canApprove ? approve(pending) : { state: "submitted" });

/**
 * Submits a draft for review and, for an editor or owner, approves it, which
 * publishes it. A draft whose review is still pending, as a send that
 * couldn't approve it leaves it, has that review approved instead; one an
 * editor withdrew or returned since is submitted again.
 */
async function sendDraft({ itemKey, kind }: SentDraft, route: PublishingChoice["route"] | null, canApprove: boolean, pending: PendingReview | undefined): Promise<PublishState> {
	if (pending) return sendPending(pending, canApprove);
	// A record imported with a DOI keeps it.
	const doi = kind === "created" ? await chooseDoiRoute(itemKey, route) : undefined;
	// The review keeps the route it was submitted on, which holds the import's route while it waits.
	const review = { ...(await submitAdminReview(itemKey)), route: kind === "created" ? route : null };
	return canApprove ? approve(review) : { doi, state: "submitted" };
}

/** Records a draft's send, and a review it left pending, which holds the DOI route until the server's status reports it. */
type Mark = (id: string, state: PublishState, review?: PendingReview) => void;

/** What a failed send leaves: why, and the review it submitted when only the approval failed. */
function failure(caught: unknown): [PublishState, PendingReview | undefined] {
	if (caught instanceof NotApprovedError) return [{ message: publishError(caught.reason), state: "failed" }, caught.review];
	return [{ message: publishError(caught), state: "failed" }, undefined];
}

/**
 * Sends one draft on, unless the server says it is published already, or that
 * it lacks something its route needs, which it then says rather than failing.
 */
async function sendNow(draft: SentDraft, route: ImportBatch["publishRoute"], canApprove: boolean, now: SentNow): Promise<PublishState> {
	const needs = draftNeeds(now.needs, route, draft.id, draft.kind);
	if (Object.keys(needs).length) return { message: needsText(needs), state: "failed" };
	return now.sent[draft.id] === "published" ? { state: "published" } : sendDraft(draft, route, canApprove, now.reviews[draft.id]);
}

async function sendOne(draft: SentDraft, route: ImportBatch["publishRoute"], canApprove: boolean, now: SentNow, mark: Mark) {
	try {
		mark(draft.id, await sendNow(draft, route, canApprove, now));
	} catch (caught) {
		console.error("Sending the draft on failed", draft.itemKey, caught);
		mark(draft.id, ...failure(caught));
	}
}

/**
 * Sends drafts on the way the record inspector does. A draft made from a
 * PDF takes the import's DOI route when one is switched on, and on
 * Crossref its DOI is reserved; then the draft is submitted for review.
 * Editors and owners approve it at once, which publishes it, and the
 * publication worker activates the DOI; anyone else leaves it for an editor.
 */
async function sendDrafts(batch: ImportBatch, drafts: readonly SentDraft[], approve: boolean, { onBeforeSend, onImported }: Pick<ImportFlowProps, "onBeforeSend" | "onImported">) {
	const mark: Mark = (id, state, review) => changeImportBatch(batch, (current) => ({ ...current, publish: new Map(current.publish).set(id, state), reviews: review ? { ...current.reviews, [id]: review } : current.reviews }));
	// Without the import's status, or with an edit to one of them that couldn't be saved, nothing is sent, and the drafts can be tried again.
	const failAll = (caught: unknown) => drafts.forEach(({ id }) => mark(id, { message: publishError(caught), state: "failed" }));
	changeImportBatch(batch, (current) => ({ ...current, sendApproves: approve }));
	for (const { id } of drafts) mark(id, { state: "sending" });
	try {
		await onBeforeSend(drafts.map(({ itemKey }) => itemKey));
		const now = await sentNow(batch.importId);
		await inTurn(drafts, SEND_CONCURRENCY, (draft) => sendOne(draft, routeOf(batch), approve, now, mark));
	} catch (caught) {
		failAll(caught);
	}
	// The table shows their new state; the import's drafts stay the selection.
	await onImported(createdKeys(batch.results ?? []));
}

/** Ends the import here and, for a PDF import, on the server, which removes its stored PDFs. */
async function endBatch(batch: ImportBatch | null) {
	if (!batch) return;
	if (batch.kind === "pdfs") {
		await closeAdminPdfImport(batch.importId);
		await mutate(PDF_IMPORT_KEY);
	}
	endImportBatch(batch.importId);
}

export type ImportFlowProps = {
	/** Saves what the editor changed in these drafts and hasn't saved yet, so a send takes it; it throws when it can't. */
	onBeforeSend: (itemKeys: readonly string[]) => Promise<void>;
	onClose: () => void;
	onImported: (itemKeys: string[]) => Promise<void> | void;
	onOpenRecord: (itemKey: string) => void;
	sources: readonly AdminSource[];
};

/** What the Add step holds: the source, what was added, and the checks and instructions for PDFs. */
function useAddInputs(batchKind: ImportKind | undefined) {
	const last = usePdfImportStatus().data?.last;
	const [kind, setKind] = useState<ImportKind>(batchKind ?? "pdfs");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [pdfs, setPdfs] = useState<File[]>([]);
	// The library's last import's checks and instructions until the editor changes them here.
	const [editedChecks, setChecks] = useState<string[] | null>(null);
	// A list, so a row emptied while it is being edited stays until it loses focus.
	const [editedInstructions, setInstructions] = useState<string[] | null>(null);
	// Chosen before reading starts; the batch carries them from then on.
	const [collections, setCollections] = useState<string[]>([]);
	const instructions = startingInstructions(editedInstructions, last);
	const guidance = instructions.map((line) => line.trim()).filter(Boolean).join("\n");
	return { checks: startingChecks(editedChecks, last), collections, doiText, files, guidance, instructions, kind, pdfs, setChecks, setCollections, setDoiText, setFiles, setInstructions, setKind, setPdfs };
}

/** Changes to the import being reviewed: what is ticked, applied and chosen, and how its drafts are sent on. */
function batchChanges(batch: ImportBatch | null) {
	const change = (update: (current: ImportBatch) => ImportBatch) => batch && changeImportBatch(batch, update);
	return {
		/** Ready records not in `next` stay out of the import. */
		setSelected: (next: ReadonlySet<string>) => change((current) => ({ ...current, excluded: new Set(readyIds(current.rows).filter((id) => !next.has(id))) })),
		choosePublish: (ids: ReadonlySet<string>) => change((current) => ({ ...current, toPublish: ids })),
		setPublishRoute: (route: PublishingChoice["route"] | null) => change((current) => ({ ...current, publishRoute: route })),
		setOutcome: (outcome: ImportOutcome) => change((current) => ({ ...current, outcome })),
		toggleSuggestion: (rowId: string, index: number) => change((current) => withSuggestionToggled(current, rowId, index)),
		toggleChoice: (rowId: string, kind: ChoiceKind, id: string) => change((current) => withChoiceToggled(current, rowId, kind, id)),
		/** Picks the licence for each of these records, in place of what their PDFs named. */
		setLicence: (rowIds: readonly string[], licence: RecordLicence) => change((current) => ({ ...current, licences: new Map([...current.licences, ...rowIds.map((id): [string, RecordLicence] => [id, licence])]) })),
	};
}

/**
 * Everything the Import dialog knows and does, whatever it looks like: the
 * source and what was added, the batch being reviewed, and the steps from
 * reading to importing and publishing. Every design draws from this one.
 */
export function useImportFlow({ onBeforeSend, onClose, onImported, onOpenRecord, sources }: ImportFlowProps) {
	const topicsEnabled = useLibraryConfig().topics.enabled;
	const { doiProviders } = useAdminSession();
	// An editor can step out of the PDF import's review to import DOIs or files; it carries on meanwhile, and only one is open.
	const [besidePdfs, setBesidePdfs] = useState(false);
	const { batch, openPdfs } = shownImport(useImportBatches(), besidePdfs);
	const inputs = useAddInputs(batch?.kind);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [filter, setFilter] = useState<ReviewFilter>("all");
	const [busy, setBusy] = useState(false);
	// An error belongs to the step it happened on: a commit another tab got to first is moot once the import shows its drafts.
	const [failure, setFailure] = useState<{ message: string; stage: ImportStage } | null>(null);

	const stage = stageOf(batch);
	const error = failure?.stage === stage ? failure.message : null;
	const fields = batchFields(batch, inputs.collections, busy);
	const appliedFor = (row: ImportRow) => appliedOf(batch, row);
	const choicesOf = (row: ImportRow, kind: ChoiceKind) => (batch ? chosenOf(batch, row, kind) : new Set<string>());
	const topicNames = (row: ImportRow) => row.topics.filter(({ id }) => choicesOf(row, "topics").has(id)).map(({ name }) => name);

	const run = async (work: () => Promise<void>) => {
		setFailure(null);
		setBusy(true);
		try {
			await work();
		} catch (caught) {
			setFailure({ message: errorMessage(caught), stage });
		} finally {
			setBusy(false);
		}
	};

	const start = () =>
		run(async () => {
			setFilter("all");
			// With a PDF import open, the PDFs tab leads back to it rather than reading more.
			if (inputs.kind === "pdfs") return openPdfs ? setBesidePdfs(false) : startPdfImport(inputs);
			await startLookupImport({ ...inputs, kind: inputs.kind }, setActiveId);
		});

	const restart = () =>
		run(async () => {
			await endBatch(batch);
			// Leaving a DOI or file import goes back to the Add step, even with a PDF import open.
			if (batch?.kind !== "pdfs") setBesidePdfs(true);
			if (stage !== "done") return;
			inputs.setPdfs([]);
			inputs.setFiles([]);
			inputs.setDoiText("");
		});

	const close = () => {
		dropLookup();
		onClose();
	};

	const finish = () =>
		run(async () => {
			await endBatch(batch);
			close();
		});

	return {
		...reviewRows(batch, filter, activeId),
		...reviewProgress(batch),
		...addStep(inputs.kind, openPdfs, inputs, stage),
		...batchChanges(batch),
		...inputs,
		...fields,
		appliedFor,
		batch,
		busy,
		checksOf: (row: ImportRow) => reviewChecks(row, appliedFor(row)),
		choicesOf,
		/** What a ready record still needs to publish, from its reading with the applied suggestions. */
		needsOf: (row: ImportRow) => readingNeeds(row, appliedFor(row), reviewRoute(batch, doiProviders.zenodo), licenceOf(batch, row)),
		licenceOf: (row: ImportRow) => licenceOf(batch, row),
		/** `publish`: an Editor or Owner sends the drafts on published, not to the review queue. */
		commit: (publish = false) => void run(async () => (batch ? commitBatch(batch, topicsEnabled, onImported, publish) : undefined)),
		error,
		filter,
		finish: () => void finish(),
		onClose: close,
		onOpenRecord,
		openPdfs,
		primaryLabel: primaryLabel(inputs.kind, inputs, openPdfs),
		propertiesOf: (row: ImportRow) => publishedProperties(row, appliedFor(row), topicNames(row)),
		restart: () => void restart(),
		/** Publishes the drafts when `approve` (editors and owners), else submits them for review. */
		send: (drafts: readonly SentDraft[], approve: boolean) => void (batch && sendDrafts(batch, drafts, approve, { onBeforeSend, onImported })),
		setActiveId,
		/** Steps out of the open PDF import's review to the Add step, leaving the import as it is. */
		addBeside: () => setBesidePdfs(true),
		setCollections: (keys: string[]) => (batch ? changeImportBatch(batch, (current) => ({ ...current, collections: keys })) : inputs.setCollections(keys)),
		setFilter,
		setKind: (value: ImportKind) => {
			inputs.setKind(value);
			setFailure(null);
		},
		sources,
		stage,
		start: () => void start(),
	};
}

export type ImportFlowState = ReturnType<typeof useImportFlow>;
