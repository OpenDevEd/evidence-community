"use client";

import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import { useState } from "react";
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
import { AdminApiError, commitAdminImport, previewAdminImport } from "./admin-api";
import {
	doiPreviewRequest,
	filePreviewRequest,
	importRowCells,
	importRowStatus,
	importStage,
	readyImportIds,
	selectedImportRecords,
	summarizeImportResults,
	toggleImportSelection,
} from "./admin-import";

type ImportTab = "dois" | "files";
type ImportStage = "done" | "input" | "preview";
type ImportPreview = { importId: string; records: AdminImportPreviewRecord[] };

const stateTone: Record<AdminImportPreviewRecord["state"], string> = {
	attention: "text-amber-700 dark:text-amber-400",
	existing: "text-black/55 dark:text-white/55",
	ready: "text-emerald-700 dark:text-emerald-400",
	repeated: "text-black/55 dark:text-white/55",
	unresolved: "text-danger",
};

function errorMessage(error: unknown) {
	if (error instanceof AdminApiError) {
		const fieldMessages = Object.values(error.fields);
		return fieldMessages.length ? `${error.message} ${fieldMessages.join(" ")}` : error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/**
 * Import records from a pasted DOI list or bibliography files. Both paths
 * return one preview; the chosen rows become native drafts in one call.
 */
export function AdminImportDialog({
	isOpen,
	onClose,
	onImported,
	sources,
}: {
	isOpen: boolean;
	onClose: () => void;
	onImported: (itemKeys: string[]) => Promise<void> | void;
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
					<ImportForm onClose={onClose} onImported={onImported} sources={sources} />
				) : null}
			</ModalContent>
		</DialogModal>
	);
}

function ImportForm({
	onClose,
	onImported,
	sources,
}: {
	onClose: () => void;
	onImported: (itemKeys: string[]) => Promise<void> | void;
	sources: readonly AdminSource[];
}) {
	const [tab, setTab] = useState<ImportTab>("dois");
	const [doiText, setDoiText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<ImportPreview | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [collections, setCollections] = useState<string[]>([]);
	const [results, setResults] = useState<AdminImportCommitResult[] | null>(null);
	const stage: ImportStage = importStage(preview, results);

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

	const runPreview = () =>
		run(async () => {
			const request = tab === "dois" ? doiPreviewRequest(doiText) : await filePreviewRequest(files);
			const response = await previewAdminImport(request);
			setPreview({ importId: crypto.randomUUID(), records: response.records });
			setSelected(new Set(readyImportIds(response.records)));
		});

	const runCommit = () =>
		run(async () => {
			if (!preview) return;
			const response = await commitAdminImport({
				collections,
				importId: preview.importId,
				records: selectedImportRecords(preview.records, selected),
			});
			setResults(response.results);
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
				{preview ? (
					<ImportPreviewPanel
						busy={busy}
						collections={collections}
						onCollectionsChange={setCollections}
						onSelectedChange={setSelected}
						preview={preview}
						results={results}
						selected={selected}
						sources={sources}
					/>
				) : (
					<ImportInputPanel
						doiText={doiText}
						files={files}
						onDoiTextChange={setDoiText}
						onFilesChange={setFiles}
						onTabChange={setTab}
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
				onBack={() => {
					setPreview(null);
					setError(null);
				}}
				onClose={onClose}
				onCommit={() => void runCommit()}
				onPreview={() => void runPreview()}
				selectedCount={selected.size}
				stage={stage}
			/>
		</>
	);
}

function ImportInputPanel({
	doiText,
	files,
	onDoiTextChange,
	onFilesChange,
	onTabChange,
	tab,
}: {
	doiText: string;
	files: File[];
	onDoiTextChange: (value: string) => void;
	onFilesChange: (files: File[]) => void;
	onTabChange: (tab: ImportTab) => void;
	tab: ImportTab;
}) {
	return (
		<Tabs
			aria-label="Import source"
			onSelectionChange={(key) => onTabChange(key as ImportTab)}
			selectedKey={tab}
		>
			<Tab key="dois" title="DOIs">
				<Textarea
					aria-label="DOIs"
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
				<input
					accept={ADMIN_IMPORT_FILE_EXTENSIONS}
					aria-label="Bibliography files"
					className="block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-black/[0.05] file:px-3 file:py-2 file:text-sm file:font-medium dark:file:bg-white/[0.08]"
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
			</Tab>
		</Tabs>
	);
}

function ImportPreviewPanel({
	busy,
	collections,
	onCollectionsChange,
	onSelectedChange,
	preview,
	results,
	selected,
	sources,
}: {
	busy: boolean;
	collections: string[];
	onCollectionsChange: (keys: string[]) => void;
	onSelectedChange: (selected: Set<string>) => void;
	preview: ImportPreview;
	results: AdminImportCommitResult[] | null;
	selected: Set<string>;
	sources: readonly AdminSource[];
}) {
	const locked = busy || results !== null;
	return (
		<>
			<PreviewTable
				locked={locked}
				onSelectedChange={onSelectedChange}
				records={preview.records}
				results={results}
				selected={selected}
			/>
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
			<td className="max-w-40 truncate p-2" title={record.source}>
				{record.source}
			</td>
			<td className={`p-2 ${stateTone[status.tone]}`}>
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
	onBack,
	onClose,
	onCommit,
	onPreview,
	selectedCount,
	stage,
}: {
	busy: boolean;
	onBack: () => void;
	onClose: () => void;
	onCommit: () => void;
	onPreview: () => void;
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
				onCommit={onCommit}
				onPreview={onPreview}
				selectedCount={selectedCount}
				stage={stage}
			/>
		</ModalFooter>
	);
}

function PrimaryAction({
	busy,
	onCommit,
	onPreview,
	selectedCount,
	stage,
}: {
	busy: boolean;
	onCommit: () => void;
	onPreview: () => void;
	selectedCount: number;
	stage: ImportStage;
}) {
	if (stage === "done") return null;
	if (stage === "input") {
		return (
			<Button color="accent" isLoading={busy} onPress={onPreview} size="xs" variant="solid">
				Preview
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
