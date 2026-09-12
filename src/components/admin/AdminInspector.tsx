"use client";
import { PdfFileInput } from "./PdfFileInput";
import { AdminDocumentHeader } from "./AdminDocumentHeader";
import { AdminPdfCover } from "./AdminPdfCover";
import type { PdfUploadStep } from "./admin-pdf";

import { creatorDisplayName } from "@/lib/creator-display-name";
import { CreatorsEditor } from "./CreatorsEditor";
import { describeCountryFocus } from "@/lib/country-focus";
import { CountryFocusInput } from "./CountryFocusInput";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { PublishingChoicePanel } from "./PublishingChoicePanel";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	Add01Icon,
	AlertCircleIcon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	AttachmentIcon,
	Cancel01Icon,
	CheckmarkBadge01Icon,
	Copy01Icon,
	Delete02Icon,
	Download01Icon,
	FileAttachmentIcon,
	FilePenLineIcon,
	FilePlusIcon,
	Folder01Icon,
	Link02Icon,
	LinkSquare01Icon,
	LockIcon,
	PencilIcon,
	RotateLeft01Icon,
	SentIcon,
	Tag01Icon,
	Tick01Icon,
	UserGroupIcon,
	WorkHistoryIcon,
} from "@hugeicons/core-free-icons";
import {
	AutocompleteItem,
	Chip,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nextui-org/react";
import { Spinner } from "@/components/nextui/Spinner";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Autocomplete } from "@/components/nextui/Autocomplete";
import { filledInputSlots } from "@/components/nextui/field-styles";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Textarea } from "@/components/nextui/Textarea";
import { Tooltip } from "@/components/nextui/Tooltip";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import type {
	AdminCreator,
	AdminItemDetail,
	AdminItemLinkKind,
	AdminLinkTarget,
	AdminSource,
} from "@/lib/admin/types";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { editableItemCollectionSourceKeys } from "@/lib/admin/item-collection-policy";
import { isTopLevelAdminItemType } from "@/lib/admin/item-fields";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import { collectionKeysFromPayload } from "@/lib/admin/item-payload";
import { buildAdminPublicItemUrl } from "@/lib/admin/public-link";
import { useFinePointer } from "@/hooks/useBreakpoint";

import {
	adminCollectionPath,
	AdminCollectionPicker,
} from "./AdminCollectionPicker";
import { FileStateChip, RecordStateChip } from "./AdminStatus";
import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";

import { AdminSourcesWritebackStatus } from "./AdminSourceWritebackStatus";
import {
	computeAdminDraftDiff,
	EMPTY_ADMIN_DRAFT_DIFF,
	type AdminDraftDiff,
} from "./admin-diff";
import {
	adminFieldDescriptors,
	type AdminSchemaDefinition,
	definitionFor,
	humanizeAdminField,
} from "./admin-schema";
import { firstAdminFieldError, validationTargetId } from "./admin-validation";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";
import { AdminLinksEditor } from "./AdminLinksEditor";
import { AdminMetadataField } from "./AdminMetadataField";
import { useAdminSession } from "./AdminSessionProvider";
import { AdminPublicationHeaderStatus } from "./AdminPublicationStatus";
import { useAdminPublication } from "./useAdminPublication";

type SaveState = "conflict" | "error" | "idle" | "saved" | "saving";

const writebackUnavailableMessage = {
	"item-locked": "Writeback is locked for this record.",
	"not-linked": "This record is not linked to a writeback source.",
	ok: "This record is read only.",
	"source-disabled": "Writeback is disabled for this source.",
	"source-paused": "This record's source is paused.",
	"source-removed": "This record's source has been removed.",
	"unsupported-provider": "This source type does not support writeback.",
} as const;

const inspectorInputClassNames = {
	input: "text-sm",
	inputWrapper: `h-10 min-h-10 rounded-xl ${filledInputSlots.inputWrapper}`,
} as const;

const inspectorTextareaClassNames = {
	input: "text-sm",
	inputWrapper: "rounded-xl",
} as const;

const inspectorSelectClassNames = {
	trigger: "h-10 min-h-10 rounded-xl",
	value: "text-sm",
} as const;

function publicationInputVersion(detail: AdminItemDetail) {
	return [
		String(detail.revision),
		...detail.attachments
			.map(
				(attachment) =>
					`${attachment.key}:${attachment.revision}:${attachment.filePublication?.uploadRevision ?? 0}:${attachment.filePublication?.publishedAt ?? ""}`,
			)
			.sort(),
	].join("|");
}

function FieldLabel({
	action,
	children,
	htmlFor,
}: {
	action?: React.ReactNode;
	children: React.ReactNode;
	htmlFor?: string;
}) {
	const className =
		"block text-xs font-medium text-black/55 dark:text-white/55";
	return (
		<div className="flex min-h-6 items-center gap-1.5">
			{htmlFor ? (
				<label className={className} htmlFor={htmlFor}>
					{children}
				</label>
			) : (
				<span className={className}>{children}</span>
			)}
			{action}
		</div>
	);
}

function ChangedMarker({
	label,
	onRevert,
	publishedValue,
}: {
	label: string;
	onRevert: () => void;
	publishedValue: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover
			isOpen={open}
			offset={7}
			placement="bottom-end"
			onOpenChange={setOpen}
		>
			<PopoverTrigger>
				<button
					aria-label={`Changed: show published ${label}`}
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
					title={`${label} differs from the published value`}
					type="button"
				>
					<HugeiconsIcon
						icon={PencilIcon}
						aria-hidden
						size={11}
						strokeWidth={2}
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-64 rounded-xl border border-black/[0.08] bg-white p-3 shadow-lg dark:border-white/[0.09] dark:bg-card">
				<div className="w-full">
					<p className="text-[11px] font-medium text-black/40 dark:text-white/40">
						Published value
					</p>
					<div className="mt-1.5 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-black/75 dark:text-white/75">
						{publishedValue}
					</div>
					<Button
						className="mt-2.5 px-2.5 font-medium"
						onPress={() => {
							onRevert();
							setOpen(false);
						}}
						size="xs"
						startContent={
							<HugeiconsIcon
								icon={RotateLeft01Icon}
								aria-hidden
								size={13}
							/>
						}
						variant="transparent"
					>
						Revert to published
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function PublishedList({ values }: { values: readonly string[] }) {
	if (values.length === 0) {
		return <span className="text-black/40 dark:text-white/40">Empty</span>;
	}
	return (
		<ul className="space-y-1">
			{values.map((value, index) => (
				<li key={`${index}:${value}`}>{value}</li>
			))}
		</ul>
	);
}

function IconButton({
	buttonId,
	disabled,
	icon: Icon,
	label,
	onPress,
}: {
	buttonId?: string;
	disabled?: boolean;
	icon: typeof Add01Icon;
	label: string;
	onPress: () => void;
}) {
	return (
		<Tooltip content={label} delay={500}>
			<span>
				<Button
					aria-label={label}
					className="text-black/45 hover:bg-black/[0.05] hover:text-black/80 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/85"
					id={buttonId}
					isDisabled={disabled}
					isIconOnly
					onPress={onPress}
					size="xs"
					variant="transparent"
				>
					<HugeiconsIcon icon={Icon} aria-hidden size={14} />
				</Button>
			</span>
		</Tooltip>
	);
}

function Section({
	actions,
	children,
	icon: Icon,
	id,
	title,
}: {
	actions?: React.ReactNode;
	children: React.ReactNode;
	icon: typeof Add01Icon;
	id?: string;
	title: string;
}) {
	return (
		<section className="scroll-mt-4 py-5 first:pt-0" id={id}>
			<div className="mb-3 flex min-h-6 items-center gap-2.5">
				<HugeiconsIcon
					icon={Icon}
					aria-hidden
					className="shrink-0 text-black/35 dark:text-white/35"
					size={15}
					strokeWidth={1.8}
				/>
				<h3 className="text-sm font-semibold text-black/80 dark:text-white/85">
					{title}
				</h3>
				<span
					aria-hidden
					className="h-px min-w-4 flex-1 bg-black/[0.06] dark:bg-white/[0.07]"
				/>
				{actions}
			</div>
			{children}
		</section>
	);
}

function EmptyValue({ label }: { label: string }) {
	return (
		<div className="flex min-h-9 items-center text-xs text-black/35 dark:text-white/35">
			<span>{label}</span>
		</div>
	);
}

function SaveIndicator({
	message,
	onReload,
	state,
}: {
	message: string | null;
	onReload: () => void;
	state: SaveState;
}) {
	if (state === "idle") return null;
	return (
		<div
			aria-live={state === "error" ? "assertive" : "polite"}
			className={`flex items-center gap-1.5 text-[11px] ${
				state === "error"
					? "text-danger"
					: state === "conflict"
						? "text-amber-800 dark:text-amber-200"
						: "text-black/40 dark:text-white/40"
			}`}
			role={state === "error" ? "alert" : "status"}
		>
			{state === "saving" ? (
				<Spinner size="sm" />
			) : state === "saved" ? (
				<HugeiconsIcon icon={Tick01Icon} aria-hidden size={12} />
			) : (
				<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={12} />
			)}
			{message ??
				(state === "saving"
					? "Saving"
					: state === "saved"
						? "Saved"
						: state === "conflict"
							? "Changed in another session"
							: "Needs attention")}
			{state === "conflict" ? (
				<IconButton
					icon={RotateLeft01Icon}
					label="Reload server draft"
					onPress={onReload}
				/>
			) : null}
		</div>
	);
}

/**
 * Headline for the field summary. A conflict is not a mistake the editor made,
 * so it must not read like a validation error.
 */
export function fieldSummaryHeadline(
	count: number,
	tone: "conflict" | "validation",
) {
	const fields = count === 1 ? "field" : "fields";
	return tone === "conflict"
		? `${count} ${fields} changed in another session. Reload to see the new ${count === 1 ? "value" : "values"}.`
		: `Fix ${count} ${fields} before publishing.`;
}

function ValidationSummary({
	errors,
	recordKey,
	tone,
}: {
	errors: AdminFieldErrors;
	recordKey: string;
	tone: "conflict" | "validation";
}) {
	const entries = Object.entries(errors);
	if (entries.length === 0) return null;
	const conflict = tone === "conflict";
	return (
		<div
			id={`admin-${recordKey}-validation-summary`}
			className={`mt-3 rounded-xl px-3 py-2.5 text-xs outline-none focus-visible:ring-2 ${
				conflict
					? "bg-amber-500/[0.1] text-amber-800 focus-visible:ring-amber-500 dark:text-amber-200"
					: "bg-danger/[0.08] text-danger focus-visible:ring-danger"
			}`}
			role={conflict ? "status" : "alert"}
			tabIndex={-1}
		>
			<div className="flex items-center gap-2 font-medium">
				{conflict ? (
					<HugeiconsIcon
						icon={RotateLeft01Icon}
						aria-hidden
						size={14}
					/>
				) : (
					<HugeiconsIcon
						icon={AlertCircleIcon}
						aria-hidden
						size={14}
					/>
				)}
				{fieldSummaryHeadline(entries.length, tone)}
			</div>
			<ul className="mt-1.5 space-y-1 pl-5">
				{entries.map(([path, message]) => {
					const targetId = validationTargetId(recordKey, path);
					return (
						<li key={path}>
							{targetId ? (
								<button
									className={`text-left underline underline-offset-2 ${conflict ? "decoration-amber-500/50 hover:decoration-amber-600" : "decoration-danger/40 hover:decoration-danger"}`}
									type="button"
									onClick={() =>
										document
											.getElementById(targetId)
											?.focus()
									}
								>
									{message}
								</button>
							) : (
								message
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function CountryFocusEditor({
	payload,
	titleField,
	change,
	onChange,
	readOnly,
	error,
}: {
	payload: Record<string, unknown>;
	titleField: string;
	change: AdminDraftDiff["countryFocus"];
	onChange: (payload: Record<string, unknown>) => void;
	readOnly: boolean;
	error?: string;
}) {
	return (
		<div className="space-y-1.5 pt-1.5">
			<FieldLabel
				action={
					change && !readOnly ? (
						<ChangedMarker
							label="country focus"
							publishedValue={describeCountryFocus(
								change.previous,
							)}
							onRevert={() =>
								onChange({
									...payload,
									countryFocus: change.previous,
								})
							}
						/>
					) : null
				}
			>
				Country focus
			</FieldLabel>
			<CountryFocusInput
				disabled={readOnly}
				value={
					Array.isArray(payload.countryFocus)
						? (payload.countryFocus as string[])
						: null
				}
				onChange={(countryFocus) =>
					onChange({ ...payload, countryFocus })
				}
				title={String(payload[titleField] ?? "")}
				abstract={String(payload.abstractNote ?? "")}
			/>
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
}

function countryFocusPlacement(definition: AdminSchemaDefinition | undefined) {
	const metadataFields = adminFieldDescriptors(definition);
	const titleField =
		metadataFields.find(({ semanticField }) => semanticField === "title")
			?.field ?? "title";
	const countryFocusAfterField = metadataFields.some(
		({ field }) => field === "abstractNote",
	)
		? "abstractNote"
		: titleField;
	return { titleField, countryFocusAfterField };
}

function MetadataEditor({
	definitions,
	detail,
	diff,
	errors,
	onChange,
	payload,
	readOnly,
	lockedDoi,
}: {
	definitions: readonly AdminSchemaDefinition[];
	detail: AdminItemDetail;
	diff: AdminDraftDiff;
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	readOnly: boolean;
	lockedDoi: string | null;
}) {
	const definition = definitionFor(
		definitions,
		String(payload.itemType ?? detail.itemType),
	);
	const { titleField, countryFocusAfterField } = countryFocusPlacement(definition);
	const selectedItemType = definition?.itemType ?? null;
	const [itemTypeInput, setItemTypeInput] = useState(
		selectedItemType ? humanizeAdminField(selectedItemType) : "",
	);
	const updateField = (field: string, value: string) =>
		onChange({ ...payload, [field]: value });

	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<FieldLabel
					action={
						diff.itemType ? (
							<ChangedMarker
								label="item type"
								onRevert={() =>
									onChange({
										...payload,
										itemType: diff.itemType,
									})
								}
								publishedValue={humanizeAdminField(
									diff.itemType,
								)}
							/>
						) : undefined
					}
				>
					Item type
				</FieldLabel>
				<Autocomplete
					aria-label="Item type"
					allowsCustomValue={false}
					className="max-w-none"
					classNames={{
						listboxWrapper: "max-h-80",
					}}
					inputProps={{
						classNames: inspectorInputClassNames,
						id: `admin-${detail.key}-itemType`,
					}}
					errorMessage={errors.itemType}
					isDisabled={readOnly || detail.itemType === "Attachment"}
					isClearable={false}
					isInvalid={Boolean(errors.itemType)}
					inputValue={itemTypeInput}
					menuTrigger="focus"
					placeholder="Find an item type"
					selectedKey={selectedItemType}
					onInputChange={setItemTypeInput}
					onSelectionChange={(value) => {
						if (typeof value === "string") {
							setItemTypeInput(humanizeAdminField(value));
							onChange({ ...payload, itemType: value });
						}
					}}
				>
					{definitions
						.filter(
							(entry) =>
								Boolean(detail.parentItem) ||
								isTopLevelAdminItemType(entry.itemType),
						)
						.map((entry) => (
							<AutocompleteItem
								key={entry.itemType}
								textValue={humanizeAdminField(entry.itemType)}
							>
								{humanizeAdminField(entry.itemType)}
							</AutocompleteItem>
						))}
				</Autocomplete>
			</div>
			{adminFieldDescriptors(definition)
				.filter(
					({ field }) =>
						field !== "annotationPosition" &&
						field !== "annotationSortIndex",
				)
				.map((descriptor) => {
					const { field } = descriptor;
					const value =
						typeof payload[field] === "string"
							? String(payload[field])
							: "";
					const fieldId = `admin-${detail.key}-${field}`;
					const label = humanizeAdminField(field);
					const changed = Object.prototype.hasOwnProperty.call(
						diff.fields,
						field,
					);
					const original = diff.fields[field] ?? "";
					return (
						<div key={field} className="space-y-1.5">
							<FieldLabel
								action={
									changed ? (
										<ChangedMarker
											label={label.toLowerCase()}
											onRevert={() =>
												updateField(field, original)
											}
											publishedValue={
												original || (
													<span className="text-black/40 dark:text-white/40">
														Empty
													</span>
												)
											}
										/>
									) : undefined
								}
								htmlFor={fieldId}
							>
								{label}
							</FieldLabel>
							<AdminMetadataField
								descriptor={descriptor}
								disabled={
									readOnly ||
									(field === "DOI" && Boolean(lockedDoi)) ||
									(field === "annotationType" &&
										String(
											detail.published?.itemType ?? "",
										).toLowerCase() === "annotation")
								}
								error={errors[field]}
								id={fieldId}
								label={label}
								value={value}
								onValueChange={(next) =>
									updateField(field, next)
								}
							/>
							{field === countryFocusAfterField &&
								isTopLevelAdminItemType(
									String(payload.itemType ?? detail.itemType),
								) && (
									<CountryFocusEditor
										payload={payload}
										titleField={titleField}
										change={diff.countryFocus}
										onChange={onChange}
										readOnly={readOnly}
										error={errors.countryFocus}
									/>
								)}
							{field === "DOI" && lockedDoi ? (
								<p className="text-xs text-black/45 dark:text-white/45">
									Deactivate Zenodo before changing this DOI.
								</p>
							) : null}
						</div>
					);
				})}
		</div>
	);
}

function TagsEditor({
	errors,
	onChange,
	payload,
	readOnly,
	recordKey,
}: {
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	readOnly: boolean;
	recordKey: string;
}) {
	const [value, setValue] = useState("");
	const error = firstAdminFieldError(errors, "tags");
	const tags = Array.isArray(payload.tags)
		? payload.tags.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const addTag = () => {
		const tag = value.trim();
		if (!tag || tags.includes(tag)) return;
		onChange({ ...payload, tags: [...tags, tag] });
		setValue("");
	};
	return (
		<div className="space-y-2">
			{tags.length === 0 && readOnly ? (
				<EmptyValue label="No tags" />
			) : null}
			<div className="flex flex-wrap gap-1.5">
				{tags.map((tag) => (
					<Chip
						key={tag}
						className="rounded-lg bg-black/[0.045] dark:bg-white/[0.06]"
						onClose={
							readOnly
								? undefined
								: () =>
										onChange({
											...payload,
											tags: tags.filter(
												(entry) => entry !== tag,
											),
										})
						}
						size="sm"
						variant="flat"
					>
						{tag}
					</Chip>
				))}
			</div>
			{!readOnly ? (
				<Input
					color="filled"
					id={`admin-${recordKey}-tags`}
					classNames={inspectorInputClassNames}
					endContent={
						<IconButton
							disabled={!value.trim()}
							icon={Add01Icon}
							label="Add tag"
							onPress={addTag}
						/>
					}
					placeholder="Add a tag"
					errorMessage={error}
					isInvalid={Boolean(error)}
					value={value}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							addTag();
						}
					}}
					onValueChange={setValue}
				/>
			) : null}
		</div>
	);
}

function CollectionsEditor({
	errors,
	onChange,
	payload,
	publishedCollectionKeys,
	readOnly,
	recordKey,
	sourceConnectionKey,
	sources,
}: {
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	publishedCollectionKeys?: readonly string[];
	readOnly: boolean;
	recordKey: string;
	sourceConnectionKey: string;
	sources: AdminSource[];
}) {
	const finePointer = useFinePointer();
	const [pickerOpen, setPickerOpen] = useState(false);
	const error = firstAdminFieldError(errors, "collections");
	const errorId = `admin-${recordKey}-collections-error`;
	const selectedKeys = collectionKeysFromPayload(payload);
	const {
		entries,
		error: resolveError,
		loading,
		retry,
	} = useResolvedAdminCollections(selectedKeys);
	const publishedSelected = new Set(publishedCollectionKeys ?? []);
	const editableSourceKeys = editableItemCollectionSourceKeys(
		sourceConnectionKey,
		sources,
	);
	const editableSourceSet = new Set(editableSourceKeys);
	return (
		<>
			<div
				id={`admin-${recordKey}-collections`}
				aria-describedby={error ? errorId : undefined}
				aria-label="Collections"
				className={`space-y-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-danger ${
					error ? "bg-danger/5 p-2" : ""
				}`}
				role="group"
				tabIndex={-1}
			>
				{error ? (
					<p
						id={errorId}
						className="mb-1 text-xs text-danger"
						role="alert"
					>
						{error}
					</p>
				) : null}
				{resolveError ? (
					<div
						className="flex min-h-9 items-center gap-2 rounded-lg bg-danger/10 px-2.5 text-xs text-danger"
						role="alert"
					>
						<HugeiconsIcon
							icon={AlertCircleIcon}
							aria-hidden
							className="shrink-0"
							size={13}
						/>
						<span className="min-w-0 flex-1">
							Collections could not be loaded.
						</span>
						<Button onPress={retry} size="xs" variant="transparent">
							Retry
						</Button>
					</div>
				) : null}
				{loading && entries.length === 0 ? (
					<div className="grid min-h-10 place-items-center">
						<Spinner aria-label="Loading collections" size="sm" />
					</div>
				) : !resolveError && entries.length === 0 ? (
					<EmptyValue label="No collections" />
				) : null}
				{entries.map((entry) => {
					const locked =
						entry.deleted ||
						!editableSourceSet.has(entry.sourceConnectionKey);
					const membershipChanged =
						publishedCollectionKeys !== undefined &&
						!publishedSelected.has(entry.key);
					return (
						<div
							key={entry.key}
							className="flex min-h-11 items-center gap-2 rounded-lg bg-black/[0.03] px-2.5 text-xs text-black/70 dark:bg-white/[0.04] dark:text-white/75"
							data-admin-collection-membership={entry.key}
						>
							<HugeiconsIcon
								icon={Folder01Icon}
								aria-hidden
								className="shrink-0 text-black/35 dark:text-white/35"
								size={14}
								strokeWidth={1.7}
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">
									{entry.name}
								</span>
								<span className="block truncate text-[11px] text-black/40 dark:text-white/40">
									{adminCollectionPath(entry, sources)}
								</span>
							</span>
							{membershipChanged ? (
								<Tooltip content="Added in this draft">
									<HugeiconsIcon
										icon={PencilIcon}
										aria-label="Added in this draft"
										className="shrink-0 text-accent"
										size={11}
									/>
								</Tooltip>
							) : null}
							{entry.deleted ? (
								<Chip className="h-5" size="sm" variant="flat">
									Deleted
								</Chip>
							) : null}
							{locked ? (
								<HugeiconsIcon
									icon={LockIcon}
									aria-label="Read only"
									className="shrink-0 opacity-40"
									size={11}
								/>
							) : !readOnly ? (
								<button
									aria-label={`Remove ${entry.name}, ${adminCollectionPath(entry, sources)}`}
									className="grid size-7 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
									onClick={() =>
										onChange({
											...payload,
											collections: selectedKeys.filter(
												(key) => key !== entry.key,
											),
										})
									}
									type="button"
								>
									<HugeiconsIcon
										icon={Cancel01Icon}
										aria-hidden
										size={13}
									/>
								</button>
							) : null}
						</div>
					);
				})}
				{!readOnly ? (
					<Button
						onPress={() => setPickerOpen(true)}
						size="xs"
						startContent={
							<HugeiconsIcon
								icon={Add01Icon}
								aria-hidden
								size={15}
							/>
						}
						variant="muted"
					>
						Add to collection
					</Button>
				) : null}
			</div>

			<DialogModal
				isOpen={pickerOpen}
				onOpenChange={setPickerOpen}
				size="md"
			>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader>Edit collections</ModalHeader>
							<ModalBody>
								<AdminCollectionPicker
									allowedSourceKeys={editableSourceKeys}
									autoFocus={finePointer}
									initialSourceKey={sourceConnectionKey}
									onSelectionChange={(keys) =>
										onChange({
											...payload,
											collections: keys,
										})
									}
									selectedKeys={selectedKeys}
									selectionMode="multiple"
									sources={sources}
								/>
							</ModalBody>
							<ModalFooter>
								<Button
									onPress={onClose}
									size="xs"
									variant="transparent"
								>
									Done
								</Button>
							</ModalFooter>
						</>
					)}
				</ModalContent>
			</DialogModal>
		</>
	);
}


function AttachmentList({
	busy,
	detail,
	onCreateAttachment,
	onSelectAttachment,
	readOnly,
	readOnlyVersion,
}: {
	busy: boolean;
	detail: AdminItemDetail;
	onCreateAttachment: () => void;
	onSelectAttachment: (key: string) => void;
	readOnly: boolean;
	readOnlyVersion: boolean;
}) {
	return (
		<div className="space-y-2.5">
			<div className="space-y-1">
				{detail.attachments.map((attachment) => (
					<button
						key={attachment.key}
						aria-label={`Open ${attachment.title}`}
						className="flex min-h-11 w-full items-center gap-2.5 rounded-lg bg-black/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-black/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
						onClick={() => onSelectAttachment(attachment.key)}
						type="button"
					>
						<HugeiconsIcon
							icon={FileAttachmentIcon}
							aria-hidden
							className="shrink-0 text-black/40 dark:text-white/40"
							size={15}
							strokeWidth={1.7}
						/>
						<span className="min-w-0 flex-1 truncate text-sm font-medium text-black/75 dark:text-white/80">
							{attachment.title}
						</span>
						<span className="flex shrink-0 items-center gap-1">
							{!readOnlyVersion && <RecordStateChip state={attachment.state} />}
							<FileStateChip state={attachment.fileState} snapshot={readOnlyVersion} />
						</span>
						<HugeiconsIcon
							icon={ArrowRight01Icon}
							aria-hidden
							className="shrink-0 text-black/30 dark:text-white/30"
							size={14}
						/>
					</button>
				))}
			</div>
			{detail.attachments.length === 0 ? (
				<EmptyValue label="No attachments" />
			) : null}
			{!readOnly ? (
				<Button
					isDisabled={busy}
					onPress={onCreateAttachment}
					size="xs"
					startContent={
						<HugeiconsIcon
							icon={FilePlusIcon}
							aria-hidden
							size={15}
						/>
					}
					variant="muted"
				>
					Add attachment
				</Button>
			) : null}
		</div>
	);
}

function AttachmentFilePanel({
	busy,
	detail,
	fileError,
	onDiscardFile,
	onChangePdfRemoval,
	onUpload,
	readOnly,
	readOnlyVersion,
}: {
	busy: boolean;
	detail: AdminItemDetail;
	fileError?: string;
	onDiscardFile: (key: string) => void;
	onChangePdfRemoval: (key: string) => void;
	onUpload: (key: string, file: File) => void;
	readOnly: boolean;
	readOnlyVersion: boolean;
}) {
	const formatFileDetails = (bytes: number, pages: number | null | undefined) => {
		const size = bytes < 1024 * 102.4
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		return pages ? `${pages} ${pages === 1 ? "page" : "pages"}, ${size}` : size;
	};

	return (
		<div className="space-y-3">
			{fileError ? (
				<div
					className="rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger ring-1 ring-danger/25"
					role="alert"
				>
					{fileError}
				</div>
			) : null}
			{detail.filePublication ? (
				<div
					className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]"
					data-admin-file-row="published"
				>
					<div className="flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-black/80 dark:text-white/80">
								{detail.filePublication.filename}
							</p>
							<p className="mt-1 text-black/45 dark:text-white/45">
								{formatFileDetails(detail.filePublication.sizeBytes, detail.filePublication.pageCount)}
							</p>
						</div>
						<FileStateChip state="published" />
					</div>
					<p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-black/30 dark:text-white/30">
						{detail.filePublication.sha256}
					</p>
					<div className="mt-2 flex flex-wrap gap-1">
						<Button
							as="a"
							href={detail.filePublication.publicUrl}
							rel="noreferrer"
							size="xs"
							startContent={
								<HugeiconsIcon
									icon={Download01Icon}
									aria-hidden
									size={14}
								/>
							}
							target="_blank"
							variant="transparent"
						>
							Open PDF
						</Button>
						{!readOnly ? (
							<Button
								isDisabled={busy}
								onPress={() => onChangePdfRemoval(detail.key)}
								size="xs"
								startContent={
									<HugeiconsIcon
										icon={
											detail.fileRemovalPending
												? RotateLeft01Icon
												: Delete02Icon
										}
										aria-hidden
										size={14}
									/>
								}
								variant="transparent"
							>
								{detail.fileRemovalPending
									? "Undo removal"
									: "Remove PDF from draft"}
							</Button>
						) : null}
					</div>
				</div>
			) : null}
			{detail.fileDraft ? (
				<div
					className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]"
					data-admin-file-row={
						detail.fileDraft.readyAt ? "staged" : "processing"
					}
				>
					<div className="flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-black/80 dark:text-white/80">
								{detail.fileDraft.filename}
							</p>
							<p className="mt-1 text-black/45 dark:text-white/45">
								{formatFileDetails(detail.fileDraft.expectedSizeBytes, detail.fileDraft.pageCount)}
							</p>
						</div>
						<FileStateChip
							snapshot={readOnlyVersion}
							state={
								detail.fileDraft.readyAt
									? "staged"
									: "processing"
							}
						/>
					</div>
					<p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-black/30 dark:text-white/30">
						{detail.fileDraft.actualSha256 ??
							detail.fileDraft.expectedSha256}
					</p>
					{readOnly &&
					detail.fileDraft.readyAt &&
					detail.sourceFileUrl ? (
						<Button
							as="a"
							href={detail.sourceFileUrl}
							target="_blank"
							rel="noreferrer"
							size="xs"
							variant="transparent"
							className="mt-2"
							startContent={
								<HugeiconsIcon
									icon={LinkSquare01Icon}
									size={14}
								/>
							}
						>
							Open PDF
						</Button>
					) : null}
					{!readOnly ? (
						<div className="mt-2 flex flex-wrap gap-1">
							<Button
								isDisabled={busy}
								onPress={() => onDiscardFile(detail.key)}
								size="xs"
								startContent={
									<HugeiconsIcon
										icon={Delete02Icon}
										aria-hidden
										size={14}
									/>
								}
								variant="transparent"
							>
								{detail.fileDraft.readyAt
									? "Discard staged PDF"
									: "Cancel upload"}
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			{!detail.filePublication &&
			!detail.fileDraft &&
			detail.sourceFileUrl ? (
				<div className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]">
					<div className="flex items-center justify-between gap-3">
						<p className="font-medium text-black/80 dark:text-white/80">
							Source PDF
						</p>
					</div>
					<Button
						as="a"
						className="mt-2"
						href={detail.sourceFileUrl}
						rel="noreferrer"
						size="xs"
						startContent={
							<HugeiconsIcon
								icon={Download01Icon}
								aria-hidden
								size={14}
							/>
						}
						target="_blank"
						variant="transparent"
					>
						Open PDF
					</Button>
				</div>
			) : null}
			{!detail.filePublication &&
			!detail.fileDraft &&
			!detail.sourceFileUrl ? (
				<p className="text-xs text-black/40 dark:text-white/40">
					No PDF uploaded
				</p>
			) : null}
			{!readOnly ? (
				<div>
					<PdfFileInput
						attachmentKey={detail.key}
						disabled={busy}
						label={
							detail.filePublication
								? "Stage replacement"
								: "Upload PDF"
						}
						onUpload={onUpload}
					/>
				</div>
			) : null}
		</div>
	);
}

export function AdminInspector({
	readOnlyVersion = false,
	allowReviewCorrections = false,
	versionControls,
	versionNotice,
	editorNotice,
	versionActions,
	versionStatus,
	versionWithdraw,
	reviewId,
	onAddPdf,
	pdfProgress,
	publishingChoice,
	publishing,
	submissionBlocked = false,
	reviewPending = false,
	busy,
	definitions,
	detail,
	error,
	fileErrors = {},
	linkPickKind = null,
	linkTargets = [],
	loading,
	onBackToParent,
	onChange,
	onCreateAttachment,
	onDiscardDraft,
	onDiscardFile,
	onDuplicate,
	onOpenDraft,
	onManageSources,
	onPublish,
	onPublicationChanged,
	onWritebackResolved,
	onReloadDraft,
	onRetry,
	onRestore,
	onSelectAttachment,
	onStartLinkPick,
	onStopLinkPick,
	onChangePdfRemoval,
	onUpload,
	payload,
	saveMessage,
	saveState,
	sources,
	validationErrors = {},
	validationRevision = 0,
}: {
	readOnlyVersion?: boolean;
	allowReviewCorrections?: boolean;
	versionControls?: ReactNode;
	versionNotice?: (actions: ReactNode) => ReactNode;
	editorNotice?: ReactNode;
	versionActions?: ReactNode;
	versionStatus?: ReactNode;
	versionWithdraw?: ReactNode;
	reviewId?: string;
	onAddPdf: (file: File) => void;
	pdfProgress?: PdfUploadStep;
	publishingChoice?:
		import("@/lib/admin/review-contract").PublishingChoice | null;
	publishing?: ReturnType<
		typeof import("./usePublishingChoice").usePublishingChoice
	>;
	reviewPending?: boolean;
	submissionBlocked?: boolean;
	busy: boolean;
	definitions: readonly AdminSchemaDefinition[];
	detail: AdminItemDetail | null;
	error: string | null;
	fileErrors: Record<string, string>;
	/** Link kind the record table is currently picking for, if any. */
	linkPickKind?: AdminItemLinkKind | null;
	/** Records the table knows, so picked links show a title right away. */
	linkTargets?: readonly AdminLinkTarget[];
	loading: boolean;
	onBackToParent: (key: string) => void;
	onChange: (payload: Record<string, unknown>) => void;
	onCreateAttachment: () => void;
	onDiscardDraft: () => void;
	onDiscardFile: (key: string) => void;
	onDuplicate: () => void;
	onOpenDraft: () => void;
	onManageSources: () => void;
	onPublish: () => void;
	onPublicationChanged: (
		receipts?: readonly AdminSearchIndexReceipt[],
	) => Promise<void>;
	onWritebackResolved: (result: AdminSearchIndexMutationResult) => void;
	onReloadDraft: () => void;
	onRetry: () => void;
	onRestore: () => void;
	onSelectAttachment: (key: string) => void;
	onStartLinkPick?: (kind: AdminItemLinkKind) => void;
	onStopLinkPick?: () => void;
	onChangePdfRemoval: (key: string) => void;
	onUpload: (key: string, file: File) => void;
	payload: Record<string, unknown>;
	saveMessage: string | null;
	saveState: SaveState;
	sources: AdminSource[];
	validationErrors: AdminFieldErrors;
	validationRevision: number;
}) {
	const { identity } = useLibraryConfig();
	const { canPublish } = useAdminSession();
	const detailKey = detail?.key;
	const definition = useMemo(
		() =>
			detail
				? definitionFor(
						definitions,
						String(payload.itemType ?? detail.itemType),
					)
				: undefined,
		[definitions, detail, payload.itemType],
	);
	const diff = useMemo(
		() =>
			detail
				? readOnlyVersion
					? EMPTY_ADMIN_DRAFT_DIFF
					: computeAdminDraftDiff(detail, payload, definition)
				: EMPTY_ADMIN_DRAFT_DIFF,
		[definition, detail, payload, readOnlyVersion],
	);
	const { entries: publishedCollectionEntries } = useResolvedAdminCollections(
		diff.collections ?? [],
	);
	const publication = useAdminPublication(
		!readOnlyVersion && detail && !detail.parentItem && detail.published
			? detail.key
			: null,
		detail ? publicationInputVersion(detail) : null,
	);
	const publishedCollectionNames = useMemo(
		() =>
			new Map(
				publishedCollectionEntries.map((entry) => [
					entry.key,
					entry.name,
				]),
			),
		[publishedCollectionEntries],
	);
	const linkTitles = useMemo(
		() =>
			new Map(
				(detail?.links.targets ?? []).map((target) => [
					target.key,
					target.title,
				]),
			),
		[detail?.links.targets],
	);
	useEffect(() => {
		if (!detailKey || validationRevision === 0) {
			return;
		}
		// Browser focus is the outside system: move it only after validation renders.
		const frame = requestAnimationFrame(() => {
			document
				.getElementById(`admin-${detailKey}-validation-summary`)
				?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [detailKey, validationRevision]);

	const [menuOpen, setMenuOpen] = useState(false);
	const closeMenu = () => setMenuOpen(false);

	if (loading && !detail) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner aria-label="Loading record" />
			</div>
		);
	}
	if (!detail) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-black/40 dark:text-white/40">
				<p>{error ?? "Select a record to edit."}</p>
				{error ? (
					<Button onPress={onRetry} size="xs">
						Try again
					</Button>
				) : null}
			</div>
		);
	}

	const native = detail.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY;
	const isAttachment = detail.itemType.toLowerCase() === "attachment";
	const editable =
		(allowReviewCorrections || (!readOnlyVersion && detail.editable)) &&
		Boolean(detail.draft) &&
		!busy;
	const readOnly = !editable;
	const itemUrl = buildAdminPublicItemUrl(detail, identity.baseUrl);
	const restoring =
		detail.state === "deleted" &&
		(Boolean(detail.parentItem) || !detail.draft);
	const showPrimaryAction =
		!detail.parentItem || !detail.draft || restoring || !detail.editable;
	const primaryDisabled =
		busy ||
		readOnlyVersion ||
		(!detail.editable && isAttachment) ||
		(Boolean(detail.draft) &&
			(saveState === "saving" ||
				saveState === "conflict" ||
				saveState === "error" ||
				reviewPending ||
				submissionBlocked));
	const showPublicLinkActions =
		!readOnlyVersion &&
		(detail.itemType === "Attachment" || Boolean(itemUrl));

	return (
		<div
			className="flex h-full min-h-0 flex-col [@media(max-height:600px)]:overflow-y-auto"
			data-admin-region="inspector"
		>
			{versionControls}
			<AdminDocumentHeader
				menuOpen={menuOpen}
				onMenuOpenChange={setMenuOpen}
				detail={detail}
				cover={
					<AdminPdfCover
						detail={detail}
						submitted={readOnlyVersion}
						reviewId={reviewId}
						disabled={
							readOnlyVersion ||
							!detail.editable ||
							detail.state === "deleted" ||
							(isAttachment && !native) ||
							busy
						}
						progress={readOnlyVersion ? undefined : pdfProgress}
						error={
							readOnlyVersion ? undefined : fileErrors[detail.key]
						}
						onUpload={onAddPdf}
					/>
				}
				status={
					versionStatus ?? <RecordStateChip state={detail.state} />
				}
				saveIndicator={
					<SaveIndicator
						message={saveMessage}
						onReload={onReloadDraft}
						state={saveState}
					/>
				}
				parent={
					detail.parentItem ? (
						<Button
							className="ml-3 mt-2"
							size="xs"
							variant="transparent"
							onPress={() => onBackToParent(detail.parentItem!)}
							startContent={
								<HugeiconsIcon
									icon={ArrowLeft01Icon}
									size={14}
								/>
							}
						>
							Parent record
						</Button>
					) : null
				}
				menu={
					<>
						{versionNotice?.(
							readOnlyVersion
								? versionActions && versionWithdraw
								: detail.draft && !detail.parentItem && (
										<Tooltip
											content={
												detail.published
													? "Discard changes"
													: "Delete draft"
											}
										>
											<span>
												<Button
													aria-label={
														detail.published
															? "Discard changes"
															: "Delete draft"
													}
													isIconOnly
													className="h-9 w-9 rounded-xl text-black/45 hover:text-danger dark:text-white/45 dark:hover:text-danger"
													size="xs"
													variant="transparent"
													isDisabled={
														busy ||
														(reviewPending &&
															!detail.published)
													}
													onPress={() => {
														closeMenu();
														onDiscardDraft();
													}}
												>
													<HugeiconsIcon
														icon={Delete02Icon}
														size={16}
													/>
												</Button>
											</span>
										</Tooltip>
									),
						)}
						{!readOnlyVersion && !detail.editable && (
							<p className="mt-3 flex items-start gap-2 text-xs text-black/55 dark:text-white/55">
								<HugeiconsIcon
									icon={LockIcon}
									size={15}
									className="shrink-0"
								/>
								{
									writebackUnavailableMessage[
										detail.writeback.available.find(
											(target) =>
												target.sourceKey ===
												detail.writeback
													.originSourceKey,
										)?.reason ?? "not-linked"
									]
								}
							</p>
						)}
						<div className="mt-3 flex flex-wrap items-center gap-1.5 empty:hidden">
							{detail.writeback.selected.length > 0 ? (
								<AdminSourcesWritebackStatus
									canLoadRemote={!detail.parentItem}
									itemKey={detail.key}
									key={detail.key}
									onResolved={onWritebackResolved}
									revision={detail.revision}
									sources={detail.writeback.selected.map(
										(sourceKey) => {
											const target =
												detail.writeback.available.find(
													(candidate) =>
														candidate.sourceKey ===
														sourceKey,
												);
											return {
												provider:
													target?.provider ??
													"zotero",
												sourceKey,
												sourceLabel:
													target?.sourceLabel ??
													sourceKey,
											};
										},
									)}
								/>
							) : null}
							{!detail.parentItem ? (
								<AdminPublicationHeaderStatus
									onPress={() => {
										closeMenu();
										const toggle = document.getElementById(
											`admin-${detail.key}-identifiers-toggle`,
										);
										if (
											toggle?.getAttribute(
												"aria-expanded",
											) !== "true"
										) {
											toggle?.click();
										}
										document
											.getElementById(
												"admin-doi-publishing",
											)
											?.scrollIntoView({
												behavior: "smooth",
												block: "start",
											});
									}}
									state={publication}
								/>
							) : null}
						</div>
						<div className="mt-4 flex flex-wrap items-center gap-2 empty:hidden">
							{showPublicLinkActions && (
								<>
									<Button
										as="a"
										aria-label="Open public item"
										href={itemUrl ?? undefined}
										isDisabled={!itemUrl}
										target="_blank"
										rel="noreferrer"
										size="xs"
										variant="muted"
										startContent={
											<HugeiconsIcon
												icon={LinkSquare01Icon}
												size={14}
											/>
										}
									>
										Open public item
									</Button>
									<Tooltip content="Copy public item link">
										<span>
											<Button
												aria-label="Copy public item link"
												isIconOnly
												isDisabled={!itemUrl}
												size="xs"
												variant="transparent"
												onPress={() => {
													if (itemUrl)
														void navigator.clipboard
															.writeText(itemUrl)
															.then(() =>
																toast.success(
																	"Item link copied",
																),
															)
															.catch(() =>
																toast.error(
																	"Could not copy item link",
																),
															);
												}}
											>
												<HugeiconsIcon
													icon={Copy01Icon}
													size={14}
												/>
											</Button>
										</span>
									</Tooltip>
								</>
							)}
							{!readOnlyVersion &&
								!detail.parentItem &&
								detail.writeback.available.length > 0 && (
									<Button
										data-admin-writeback-sources-button
										size="xs"
										variant="muted"
										isDisabled={busy || !canPublish}
										onPress={() => {
											closeMenu();
											onManageSources();
										}}
										startContent={
											<HugeiconsIcon
												icon={Link02Icon}
												size={14}
											/>
										}
									>
										Sources
									</Button>
								)}
						</div>
					</>
				}
				actions={
					versionActions ?? (
						<>
							{showPrimaryAction && (
								<Button
									size="xs"
									color={
										primaryDisabled ? "secondary" : "accent"
									}
									variant={
										primaryDisabled ? "muted" : "solid"
									}
									className="h-9 min-w-0 flex-1 gap-1.5 rounded-xl px-3 font-semibold"
									isDisabled={primaryDisabled}
									onPress={
										!detail.editable
											? onDuplicate
											: restoring
												? onRestore
												: !detail.draft
													? onOpenDraft
													: onPublish
									}
									startContent={
										<HugeiconsIcon
											icon={
												!detail.editable
													? Copy01Icon
													: restoring
														? RotateLeft01Icon
														: !detail.draft
															? PencilIcon
															: SentIcon
											}
											size={14}
										/>
									}
								>
									{!detail.editable && !readOnlyVersion
										? "Duplicate as native"
										: restoring
											? "Restore"
											: !detail.draft
												? "Edit"
												: "Submit for review"}
								</Button>
							)}
							{versionWithdraw}
						</>
					)
				}
			/>

			<div
				className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 [@media(max-height:600px)]:flex-none [@media(max-height:600px)]:overflow-visible"
				data-admin-region="inspector-scroll"
			>
				{error && (
					<div
						role="alert"
						className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger"
					>
						<span>{error}</span>
						<Button
							onPress={onRetry}
							size="xs"
							variant="transparent"
						>
							Retry
						</Button>
					</div>
				)}
				{fileErrors[detail.key] && (
					<p
						role="alert"
						className="mb-3 rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger"
					>
						{fileErrors[detail.key]}
					</p>
				)}
				<ValidationSummary
					errors={validationErrors}
					recordKey={detail.key}
					tone={saveState === "conflict" ? "conflict" : "validation"}
				/>
				{editorNotice}
				{!detail.parentItem ? (
					<Section
						icon={CheckmarkBadge01Icon}
						id="admin-doi-publishing"
						title="Identifiers"
					>
						{publishing && (
							<PublishingChoicePanel
								detail={detail}
								readOnly={readOnlyVersion || readOnly}
								choice={
									readOnlyVersion
										? (publishingChoice ?? null)
										: undefined
								}
								model={publishing}
							/>
						)}
					</Section>
				) : null}
				<Section
					icon={FilePenLineIcon}
					id="admin-metadata"
					title="Metadata"
				>
					<MetadataEditor
						key={`${detail.key}:${String(payload.itemType ?? detail.itemType)}`}
						definitions={definitions}
						detail={detail}
						diff={diff}
						errors={validationErrors}
						onChange={onChange}
						payload={payload}
						readOnly={readOnly}
						lockedDoi={
							publication.publication?.providers.zenodo.exact
								.targetActive &&
							publication.publication.providers.zenodo.exact
								.identifierPolicy === "reuse-external"
								? (publication.publication.identifiers.doi
										?.value ?? null)
								: null
						}
					/>
				</Section>
				{definition?.creatorTypes.length ? (
					<Section
						actions={
							diff.creators ? (
								<ChangedMarker
									label="creators"
									onRevert={() =>
										onChange({
											...payload,
											creators: diff.creators,
										})
									}
									publishedValue={
										<PublishedList
											values={diff.creators.map(
												(creator) => {
													const name =
														creatorDisplayName(
															creator,
														);
													return `${humanizeAdminField(creator.creatorType)}: ${name || "Unnamed"}`;
												},
											)}
										/>
									}
								/>
							) : undefined
						}
						icon={UserGroupIcon}
						title="Creators"
					>
						<CreatorsEditor
							key={detail.key}
							definition={definition}
							errors={validationErrors}
							onChange={onChange}
							payload={payload}
							readOnly={readOnly}
							recordKey={detail.key}
						/>
					</Section>
				) : null}
				<Section
					actions={
						diff.tags ? (
							<ChangedMarker
								label="tags"
								onRevert={() =>
									onChange({ ...payload, tags: diff.tags })
								}
								publishedValue={
									<PublishedList values={diff.tags} />
								}
							/>
						) : undefined
					}
					icon={Tag01Icon}
					title="Tags"
				>
					<TagsEditor
						errors={validationErrors}
						onChange={onChange}
						payload={payload}
						readOnly={readOnly}
						recordKey={detail.key}
					/>
				</Section>
				{!detail.parentItem ? (
					<Section
						actions={
							diff.links ? (
								<ChangedMarker
									label="links"
									onRevert={() =>
										onChange({
											...payload,
											links: diff.links,
										})
									}
									publishedValue={
										<PublishedList
											values={[
												...diff.links.cites.map(
													(key) =>
														`Cites: ${linkTitles.get(key) ?? key}`,
												),
												...diff.links.related.map(
													(key) =>
														`Related: ${linkTitles.get(key) ?? key}`,
												),
											]}
										/>
									}
								/>
							) : undefined
						}
						icon={Link02Icon}
						title="Links"
					>
						<AdminLinksEditor
							detail={detail}
							errors={validationErrors}
							knownTargets={linkTargets}
							onChange={onChange}
							onOpenRecord={onBackToParent}
							onStartPick={onStartLinkPick}
							onStopPick={onStopLinkPick}
							payload={payload}
							pickingKind={linkPickKind}
							readOnly={readOnly}
							sources={sources}
						/>
					</Section>
				) : null}
				{!detail.parentItem ? (
					<Section
						actions={
							diff.collections ? (
								<ChangedMarker
									label="collections"
									onRevert={() =>
										onChange({
											...payload,
											collections: diff.collections,
										})
									}
									publishedValue={
										<PublishedList
											values={diff.collections.map(
												(key) =>
													publishedCollectionNames.get(
														key,
													) ?? key,
											)}
										/>
									}
								/>
							) : undefined
						}
						icon={Folder01Icon}
						title="Collections"
					>
						<CollectionsEditor
							errors={validationErrors}
							onChange={onChange}
							payload={payload}
							publishedCollectionKeys={
								diff.collections
									? detail.publishedCollectionKeys
									: undefined
							}
							readOnly={readOnly}
							recordKey={detail.key}
							sourceConnectionKey={detail.sourceConnectionKey}
							sources={sources}
						/>
					</Section>
				) : null}
				<Section
					icon={
						detail.itemType === "Attachment"
							? FileAttachmentIcon
							: AttachmentIcon
					}
					id="admin-attachments"
					title={
						detail.itemType === "Attachment" ? "PDF" : "Attachments"
					}
				>
					{detail.itemType === "Attachment" ? (
						<AttachmentFilePanel
							busy={busy}
							detail={detail}
							fileError={fileErrors[detail.key]}
							onDiscardFile={onDiscardFile}
							onChangePdfRemoval={onChangePdfRemoval}
							onUpload={onUpload}
							readOnly={readOnlyVersion || !native}
							readOnlyVersion={readOnlyVersion}
						/>
					) : (
						<AttachmentList
							busy={busy}
							detail={detail}
							onCreateAttachment={onCreateAttachment}
							onSelectAttachment={onSelectAttachment}
							readOnly={readOnlyVersion || !native}
							readOnlyVersion={readOnlyVersion}
						/>
					)}
				</Section>
				<Section icon={WorkHistoryIcon} title="Revision">
					<dl className="space-y-2 text-xs">
						<div className="flex items-center justify-between gap-3">
							<dt className="text-black/40 dark:text-white/40">
								Source
							</dt>
							<dd className="font-medium text-black/70 dark:text-white/75">
								{humanizeAdminField(detail.sourceConnectionKey)}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-black/40 dark:text-white/40">
								Published revision
							</dt>
							<dd className="font-medium text-black/70 dark:text-white/75">
								{detail.revision}
							</dd>
						</div>
						{detail.draft ? (
							<>
								<div className="flex items-center justify-between gap-3">
									<dt className="text-black/40 dark:text-white/40">
										Draft revision
									</dt>
									<dd className="font-medium text-black/70 dark:text-white/75">
										{detail.draft.draftRevision}
									</dd>
								</div>
								<div className="flex items-center justify-between gap-3">
									<dt className="text-black/40 dark:text-white/40">
										Draft updated
									</dt>
									<dd className="text-right font-medium text-black/70 dark:text-white/75">
										{new Date(
											detail.draft.updatedAt,
										).toLocaleString()}
									</dd>
								</div>
							</>
						) : null}
					</dl>
				</Section>
			</div>
		</div>
	);
}
