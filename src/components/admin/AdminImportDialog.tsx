"use client";

import { TruncatedText } from "@/components/nextui/TruncatedText";

import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import DialogModal from "@/components/nextui/DialogModal";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { Textarea } from "@/components/nextui/Textarea";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeysForItems } from "@/lib/admin/item-collection-policy";
import {
	ADMIN_IMPORT_FILE_EXTENSIONS,
	ADMIN_IMPORT_FILE_FORMATS,
	ADMIN_IMPORT_MAX_FILES,
	ADMIN_IMPORT_MAX_RECORDS,
	type AdminImportCommitResult,
	type AdminImportPreviewRecord,
} from "@/lib/admin/item-import-contract";
import type { AdminSource } from "@/lib/admin/types";

import { AdminCollectionPicker } from "./AdminCollectionPicker";
import { PdfInputPanel, PdfPreviewTable, PdfReadProgress, type AttachState } from "./AdminPdfImport";
import { AdminApiError, commitAdminImport, createAdminDraft, previewAdminImport, readAdminImportPdf } from "./admin-api";
import { uploadPdfFile } from "./admin-pdf";
import {
	doiPreviewRequest,
	filePreviewRequest,
	IMPORT_STATE_TONE,
	pendingPdfReads,
	readPdfs,
	storeCheckResults,
	storeCriteria,
	storedCriteria,
	validateCriteria,
	validatePdfFiles,
	type PdfRead,
	importRowCells,
	importRowStatus,
	importStage,
	readyImportIds,
	selectedImportRecords,
	summarizeImportResults,
	toggleImportSelection,
	validateImportFiles,
} from "./admin-import";

type ImportTab = "dois" | "files" | "pdfs";
type ImportStage = "done" | "input" | "preview";
type ImportPreview = { importId: string; records: AdminImportPreviewRecord[] };
type PdfImport = { criteriaCount: number; importId: string; reads: PdfRead[] };

function errorMessage(error: unknown) {
	if (error instanceof AdminApiError) {
		const fieldMessages = Object.values(error.fields);
		return fieldMessages.length ? `${error.message} ${fieldMessages.join(" ")}` : error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function importInputError(tab: ImportTab, doiText: string, files: readonly File[], pdfs: readonly File[], criteriaText: string): string | null {
	try {
		if (tab === "dois") doiPreviewRequest(doiText);
		else if (tab === "files") validateImportFiles(files);
		else {
			validatePdfFiles(pdfs);
			validateCriteria(criteriaText);
		}
		return null;
	} catch (error) {
		return errorMessage(error);
	}
}

/**
 * Import records from a pasted DOI list, bibliography files or PDFs. Each
 * path returns one preview; the chosen rows become native drafts in one call.
 * PDFs are read by AI, which fills their metadata and runs the library's
 * checks, and each PDF is attached to its draft.
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
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			scrollBehavior="inside"
			size="3xl"
		>
			<ModalContent>
				{isOpen ? (
					<ImportForm onClose={onClose} onImported={onImported} onOpenRecord={onOpenRecord} sources={sources} />
				) : null}
			</ModalContent>
		</DialogModal>
	);
}

function ImportForm({
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
	const [tab, setTab] = useState<ImportTab>("dois");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [pdfs, setPdfs] = useState<File[]>([]);
	const [criteriaText, setCriteriaText] = useState(storedCriteria);
	const [pdfImport, setPdfImport] = useState<PdfImport | null>(null);
	const [attach, setAttach] = useState<ReadonlyMap<string, AttachState>>(new Map());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<ImportPreview | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [collections, setCollections] = useState<string[]>([]);
	const [results, setResults] = useState<AdminImportCommitResult[] | null>(null);
	const stage: ImportStage = importStage(preview ?? pdfImport, results);
	const inputError = importInputError(tab, doiText, files, pdfs, criteriaText);

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

	const runPdfReads = () =>
		run(async () => {
			const criteria = validateCriteria(criteriaText);
			storeCriteria(criteriaText);
			const reads = pendingPdfReads(pdfs);
			setSelected(new Set());
			setPdfImport({ criteriaCount: criteria.length, importId: crypto.randomUUID(), reads });
			await readPdfs(
				reads,
				(file) => readAdminImportPdf(file, criteria),
				(row) => {
					setPdfImport((current) => current && { ...current, reads: current.reads.map((other) => (other.id === row.id ? row : other)) });
					if (row.record?.state === "ready") setSelected((current) => new Set(current).add(row.id));
				},
				errorMessage,
			);
		});

	const attachPdfs = async (created: AdminImportCommitResult[]) => {
		const readById = new Map(pdfImport?.reads.map((read) => [read.id, read]));
		const mark = (id: string, state: AttachState) => setAttach((current) => new Map(current).set(id, state));
		await Promise.all(
			created.map(async ({ id, itemKey }) => {
				const read = readById.get(id);
				if (!read || !itemKey) return;
				storeCheckResults(itemKey, read.checks);
				mark(id, "attaching");
				try {
					const attachment = await createAdminDraft({ collections: [], itemType: "attachment", parentItem: itemKey, tags: [], title: read.file.name });
					await uploadPdfFile(attachment.itemKey, read.file, () => undefined);
					mark(id, "attached");
				} catch (error) {
					console.error("Attaching the PDF failed", read.file.name, error);
					mark(id, "failed");
				}
			}),
		);
	};

	const runPreview = () =>
		run(async () => {
			const request = tab === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest(files);
			const response = await previewAdminImport(request);
			setPreview({ importId: crypto.randomUUID(), records: response.records });
			setSelected(new Set(readyImportIds(response.records)));
		});

	const runCommit = () =>
		run(async () => {
			const current = preview ?? (pdfImport && { importId: pdfImport.importId, records: pdfImport.reads.flatMap(({ record }) => (record ? [record] : [])) });
			if (!current) return;
			const response = await commitAdminImport({
				collections,
				importId: current.importId,
				records: selectedImportRecords(current.records, selected),
			});
			setResults(response.results);
			if (pdfImport) await attachPdfs(response.results.filter(({ outcome }) => outcome === "created"));
			const summary = summarizeImportResults(response.results);
			await onImported(summary.createdKeys);
			(summary.failed ? toast.warning : toast.success)(summary.message);
		});

	return (
		<>
			<ModalHeader className="flex flex-col gap-1">
				Import records
				<span className="text-xs font-normal text-black/55 dark:text-white/55">
					Creates unpublished drafts. Up to {ADMIN_IMPORT_MAX_RECORDS} records at once.
				</span>
			</ModalHeader>
			<ModalBody className="gap-3">
				{preview || pdfImport ? (
					<ImportPreviewPanel
						collections={collections}
						onCollectionsChange={setCollections}
						results={results}
						sources={sources}
					>
						{pdfImport ? (
							<>
								<PdfReadProgress criteriaCount={pdfImport.criteriaCount} reads={pdfImport.reads} />
								<PdfPreviewTable
									attach={attach}
									criteriaCount={pdfImport.criteriaCount}
									locked={busy || results !== null}
									onOpenRecord={onOpenRecord}
									onSelectedChange={setSelected}
									reads={pdfImport.reads}
									results={results}
									selected={selected}
								/>
							</>
						) : preview ? (
							<PreviewTable
								locked={busy || results !== null}
								onSelectedChange={setSelected}
								records={preview.records}
								results={results}
								selected={selected}
							/>
						) : null}
					</ImportPreviewPanel>
				) : (
					<ImportInputPanel
						busy={busy}
						criteriaText={criteriaText}
						doiText={doiText}
						files={files}
						inputError={inputError}
						onCriteriaChange={setCriteriaText}
						onPdfsChange={(value) => {
							setPdfs(value);
							setError(null);
						}}
						pdfs={pdfs}
						onDoiTextChange={(value) => {
							setDoiText(value);
							setError(null);
						}}
						onFilesChange={(value) => {
							setFiles(value);
							setError(null);
						}}
						onTabChange={(value) => {
							setTab(value);
							setError(null);
						}}
						tab={tab}
					/>
				)}
				{error ? (
					<p className="text-sm text-danger" role="alert">
						{error}
					</p>
				) : null}
			</ModalBody>
			<ImportFooter
				busy={busy}
				canPreview={inputError === null}
				onBack={() => {
					setPreview(null);
					setPdfImport(null);
					setError(null);
				}}
				onClose={onClose}
				onCommit={() => void runCommit()}
				onPreview={() => void (tab === "pdfs" ? runPdfReads() : runPreview())}
				previewLabel={tab === "pdfs" ? `Read ${pdfs.length || ""} ${pdfs.length === 1 ? "PDF" : "PDFs"}`.replace("  ", " ") : "Preview"}
				selectedCount={selected.size}
				stage={stage}
			/>
		</>
	);
}

function ImportInputPanel({
	busy,
	criteriaText,
	doiText,
	files,
	inputError,
	onCriteriaChange,
	onDoiTextChange,
	onFilesChange,
	onPdfsChange,
	onTabChange,
	pdfs,
	tab,
}: {
	busy: boolean;
	criteriaText: string;
	doiText: string;
	files: File[];
	inputError: string | null;
	onCriteriaChange: (value: string) => void;
	onDoiTextChange: (value: string) => void;
	onFilesChange: (files: File[]) => void;
	onPdfsChange: (files: File[]) => void;
	onTabChange: (tab: ImportTab) => void;
	pdfs: File[];
	tab: ImportTab;
}) {
	return (
		<Tabs
			aria-label="Import source"
			isDisabled={busy}
			onSelectionChange={(key) => onTabChange(key as ImportTab)}
			selectedKey={tab}
		>
			<Tab key="dois" title="DOIs">
				<Textarea
					aria-label="DOIs"
					isDisabled={busy}
					isInvalid={Boolean(doiText.trim() && inputError)}
					errorMessage={inputError}
					minRows={6}
					onValueChange={onDoiTextChange}
					placeholder={"10.1000/xyz123\nhttps://doi.org/10.1000/abc456"}
					value={doiText}
				/>
				<p className="mt-1 text-xs text-black/55 dark:text-white/55">
					One DOI per line or separated by commas. Plain DOIs and doi.org links both work.
				</p>
			</Tab>
			<Tab key="files" title="Bibliography files">
				<BibliographyFileInput busy={busy} files={files} inputError={inputError} onFilesChange={onFilesChange} />
			</Tab>
			<Tab key="pdfs" title="PDFs">
				<PdfInputPanel
					busy={busy}
					criteriaText={criteriaText}
					files={pdfs}
					inputError={inputError}
					onCriteriaChange={onCriteriaChange}
					onFilesChange={onPdfsChange}
				/>
			</Tab>
		</Tabs>
	);
}

function BibliographyFileInput({ busy, files, inputError, onFilesChange }: {
	busy: boolean;
	files: File[];
	inputError: string | null;
	onFilesChange: (files: File[]) => void;
}) {
	const fileError = files.length > 0 ? inputError : null;
	return (
		<>
			<input
				accept={ADMIN_IMPORT_FILE_EXTENSIONS}
				aria-label="Bibliography files"
				className="block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-black/[0.05] file:px-3 file:py-2 file:text-sm file:font-medium dark:file:bg-white/[0.08]"
				disabled={busy}
				aria-describedby={fileError ? "import-file-error" : undefined}
				aria-invalid={Boolean(fileError)}
				multiple
				onChange={(event) => onFilesChange(Array.from(event.currentTarget.files ?? []))}
				type="file"
			/>
			<p className="mt-2 text-xs text-black/55 dark:text-white/55">
				Supported formats: {ADMIN_IMPORT_FILE_FORMATS.join(", ")}. Up to {ADMIN_IMPORT_MAX_FILES} files, 5 MB each.
			</p>
			<ul className="mt-2 text-xs text-black/70 dark:text-white/70">
				{files.map((file) => (
					<li key={file.name}>{file.name}</li>
				))}
			</ul>
			{fileError ? (
				<p className="mt-2 text-sm text-danger" id="import-file-error" role="alert">
					{fileError}
				</p>
			) : null}
		</>
	);
}

function ImportPreviewPanel({
	children,
	collections,
	onCollectionsChange,
	results,
	sources,
}: {
	children: ReactNode;
	collections: string[];
	onCollectionsChange: (keys: string[]) => void;
	results: AdminImportCommitResult[] | null;
	sources: readonly AdminSource[];
}) {
	return (
		<>
			{children}
			{results === null ? (
				<div>
					<p className="mb-1 text-xs font-medium text-black/70 dark:text-white/70">
						Add the imported drafts to collections (optional)
					</p>
					<AdminCollectionPicker
						allowedSourceKeys={editableItemCollectionSourceKeysForItems(
							[NATIVE_SOURCE_CONNECTION_KEY],
							sources,
						)}
						onSelectionChange={onCollectionsChange}
						selectedKeys={collections}
						selectionMode="multiple"
						sources={sources}
					/>
				</div>
			) : null}
		</>
	);
}

function PreviewTable({
	locked,
	onSelectedChange,
	records,
	results,
	selected,
}: {
	locked: boolean;
	onSelectedChange: (selected: Set<string>) => void;
	records: AdminImportPreviewRecord[];
	results: AdminImportCommitResult[] | null;
	selected: Set<string>;
}) {
	const readyIds = readyImportIds(records);
	const resultById = new Map((results ?? []).map((result) => [result.id, result]));
	return (
		<div className="max-h-80 overflow-auto rounded-xl border border-black/10 dark:border-white/10">
			<table className="w-full text-left text-xs">
				<thead className="sticky top-0 bg-background_light dark:bg-card">
					<tr className="text-black/55 dark:text-white/55">
						<th className="p-2">
							<SelectAllCheckbox
								locked={locked}
								onSelectedChange={onSelectedChange}
								readyIds={readyIds}
								selected={selected}
							/>
						</th>
						<th className="p-2 font-medium">Title</th>
						<th className="p-2 font-medium">Creators</th>
						<th className="p-2 font-medium">Year</th>
						<th className="p-2 font-medium">Type</th>
						<th className="p-2 font-medium">Source</th>
						<th className="p-2 font-medium">Status</th>
					</tr>
				</thead>
				<tbody>
					{records.map((record) => (
						<PreviewRow
							key={record.id}
							locked={locked}
							onToggle={(checked) =>
								onSelectedChange(toggleImportSelection(selected, record.id, checked))
							}
							record={record}
							result={resultById.get(record.id)}
							selected={selected.has(record.id)}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SelectAllCheckbox({
	locked,
	onSelectedChange,
	readyIds,
	selected,
}: {
	locked: boolean;
	onSelectedChange: (selected: Set<string>) => void;
	readyIds: string[];
	selected: Set<string>;
}) {
	const none = readyIds.length === 0;
	const all = !none && selected.size === readyIds.length;
	return (
		<Checkbox
			aria-label="Select all ready records"
			isDisabled={locked || none}
			isIndeterminate={selected.size > 0 && !all}
			isSelected={all}
			onValueChange={(checked) => onSelectedChange(new Set(checked ? readyIds : []))}
			size="sm"
		/>
	);
}

function PreviewRow({
	locked,
	onToggle,
	record,
	result,
	selected,
}: {
	locked: boolean;
	onToggle: (checked: boolean) => void;
	record: AdminImportPreviewRecord;
	result: AdminImportCommitResult | undefined;
	selected: boolean;
}) {
	const cells = importRowCells(record);
	const status = importRowStatus(record, result);
	return (
		<tr className="border-t border-black/[0.06] align-top dark:border-white/[0.06]">
			<td className="p-2">
				<Checkbox
					aria-label={cells.label}
					isDisabled={locked || !cells.selectable}
					isSelected={selected}
					onValueChange={onToggle}
					size="sm"
				/>
			</td>
			<td className="p-2 text-black/85 dark:text-white/85">
				{cells.title ?? <span className="italic opacity-60">No title</span>}
			</td>
			<td className="p-2">{cells.creators}</td>
			<td className="p-2 tabular-nums">{cells.year}</td>
			<td className="p-2">{cells.itemType}</td>
			<td className="max-w-40 p-2">
				<TruncatedText text={record.source} focusable />
			</td>
			<td className={`p-2 ${IMPORT_STATE_TONE[status.tone]}`}>
				{status.label}
				{status.detail ? (
					<span className="block text-black/55 dark:text-white/55">{status.detail}</span>
				) : null}
			</td>
		</tr>
	);
}

function ImportFooter({
	busy,
	canPreview,
	onBack,
	onClose,
	onCommit,
	onPreview,
	previewLabel,
	selectedCount,
	stage,
}: {
	busy: boolean;
	canPreview: boolean;
	onBack: () => void;
	onClose: () => void;
	onCommit: () => void;
	onPreview: () => void;
	previewLabel: string;
	selectedCount: number;
	stage: ImportStage;
}) {
	return (
		<ModalFooter>
			{stage === "preview" ? (
				<Button isDisabled={busy} onPress={onBack} size="xs" variant="transparent">
					Back
				</Button>
			) : null}
			<Button isDisabled={busy} onPress={onClose} size="xs" variant="transparent">
				{stage === "done" ? "Close" : "Cancel"}
			</Button>
			<PrimaryAction
				busy={busy}
				canPreview={canPreview}
				onCommit={onCommit}
				onPreview={onPreview}
				previewLabel={previewLabel}
				selectedCount={selectedCount}
				stage={stage}
			/>
		</ModalFooter>
	);
}

function PrimaryAction({
	busy,
	canPreview,
	onCommit,
	onPreview,
	previewLabel,
	selectedCount,
	stage,
}: {
	busy: boolean;
	canPreview: boolean;
	onCommit: () => void;
	onPreview: () => void;
	previewLabel: string;
	selectedCount: number;
	stage: ImportStage;
}) {
	if (stage === "done") return null;
	if (stage === "input") {
		return (
			<Button color="accent" isDisabled={!canPreview} isLoading={busy} onPress={onPreview} size="xs" variant="solid">
				{previewLabel}
			</Button>
		);
	}
	return (
		<Button
			color="accent"
			isDisabled={selectedCount === 0}
			isLoading={busy}
			onPress={onCommit}
			size="xs"
			variant="solid"
		>
			Import {selectedCount} {selectedCount === 1 ? "record" : "records"}
		</Button>
	);
}
