"use client";
import { ordinaryItemTags } from "@/lib/item-display";
import { hasTag, recordPublishTags } from "@/lib/tags";
import { AdminItemDisplay, AttachmentDisplay } from "./AdminItemDisplay";
import { PdfFileInput } from "./PdfFileInput";
import { AdminDocumentHeader } from "./AdminDocumentHeader";
import { ImportChecksBadge } from "./ImportChecksBadge";
import { AdminPdfCover } from "./AdminPdfCover";
import { isUnrestoredRecord, type PdfUploadStep } from "./admin-pdf";

import { creatorDisplayName } from "@/lib/creator-display-name";
import { CreatorsEditor } from "./CreatorsEditor";
import { TopicsEditor } from "./TopicsEditor";
import { topicIdSchema } from "@/lib/topics/contract";
import { SourceConflictEditor, type SourceResolution } from "./SourceConflictEditor";
import { describeCountryFocus } from "@/lib/country-focus";
import { CountryFocusInput } from "./CountryFocusInput";
import { OpenAccessInput } from "./OpenAccessInput";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import { StudyTypeInput } from "./StudyTypeInput";
import { describeStudyTypeChoice, type StudyReading, type StudyTypeKey } from "@/lib/readings/study-types";
import { describeOpenAccessChoice } from "@/lib/open-access";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { RecordDoiPanel } from "./PublishingChoicePanel";
import { LicenceInput } from "./LicenceInput";
import { licenceLabel } from "@/lib/licences";
import { licenceComplete, recordLicenceSchema, type RecordLicence } from "@/lib/licences";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import OpenScholar from "@/components/icons/OpenScholar";
import {
	Add01Icon,
	CloudUploadIcon,
	AlertCircleIcon,
	ArchiveIcon,
	ArchiveRestoreIcon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	AttachmentIcon,
	Cancel01Icon,
	CheckmarkBadge01Icon,
	InboxIcon,
	Copy01Icon,
	Delete02Icon,
	Download01Icon,
	FileAttachmentIcon,
	FilePenLineIcon,
	FilePlusIcon,
	Folder01Icon,
	Link02Icon,
	LinkSquare01Icon,
	SquareLock01Icon,
	PencilIcon,
	RefreshIcon,
	Undo02Icon,
	SentIcon,
	Tag01Icon,
	TagsIcon,
	Tick01Icon,
	UserGroupIcon,
	ViewIcon,
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
import { type ReactNode, type SetStateAction, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Autocomplete } from "@/components/nextui/Autocomplete";
import { filledInputSlots, inspectorInputClassNames } from "@/components/nextui/field-styles";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Textarea } from "@/components/nextui/Textarea";
import { Tooltip } from "@/components/nextui/Tooltip";
import { SourceProviderIcon } from "./SourceProviderIcon";
import { ButtonGroup } from "@nextui-org/react";
import { ADMIN_BUTTON_GROUP, ADMIN_GROUP_BUTTON, ADMIN_GROUP_DIVIDER, DraftPreviewPortal, type DraftPreview, type PreviewReview } from "./DraftPreviewPane";
import { InspectorSection as Section } from "./InspectorSection";
import { InspectorListRow, InspectorListRemove } from "./InspectorListRow";
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
import { isOpenAlexWorkProvider } from "@/lib/source-providers";

import { AdminRecordStatusMenu } from "./AdminRecordStatusMenu";
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
import { TruncatedText } from "@/components/nextui/TruncatedText";

type SaveState = "conflict" | "error" | "idle" | "saved" | "saving";

const writebackUnavailableMessage = {
	"item-locked": "Writeback is locked for this record.",
	"not-linked": "This record is not linked to a writeback source.",
	ok: "This record is read only.",
	"source-disabled": "Writeback is disabled for this source.",
	"source-paused": "This record's source is paused.",
	"source-removed": "This record's source has been removed.",
	"unsupported-provider": "This source keeps its own copy: it can't be changed from here.",
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
	const marker = useRef<HTMLSpanElement>(null);
	return (
		<Popover
			isOpen={open}
			offset={7}
			placement="bottom-end"
			onOpenChange={setOpen}
		>
			<Tooltip content={`${label} differs from the published value`}>
				<span className="inline-flex" ref={marker}>
					<PopoverTrigger>
						<button
							aria-label={`Changed: show published ${label}`}
							className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
				</span>
			</Tooltip>
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
						onPress={(press) => {
							// The marker leaves with the change, and the popover would hand focus back to it, so focus would fall to the
							// page. Its row holds it instead, so Tab goes on to the field; a field's own box would open its list.
							const row = marker.current?.parentElement;
							onRevert();
							setOpen(false);
							requestAnimationFrame(() => {
								if (!row) return;
								row.tabIndex = -1;
								row.focus({ focusVisible: press.pointerType === "keyboard" });
							});
						}}
						size="xs"
						startContent={
							<HugeiconsIcon
								icon={Undo02Icon}
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
		<Tooltip content={label}>
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

function SaveIndicator({
	conflictCount,
	onResolveConflicts,
	message,
	onReload,
	state,
}: {
	conflictCount: number;
	onResolveConflicts?: () => void;
	message: string | null;
	onReload: () => void;
	state: SaveState;
}) {
	if (state === "conflict" && onResolveConflicts && conflictCount > 0)
		return (
			<div
				role="status"
				className="flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-200"
			>
				<HugeiconsIcon icon={AlertCircleIcon} size={14} />
				<span>
					{conflictCount === 1
						? "One edit needs a choice"
						: `${conflictCount} edits need a choice`}
				</span>
				<Button
					size="xs"
					variant="transparent"
					onPress={onResolveConflicts}
					endContent={<HugeiconsIcon icon={ArrowRight01Icon} size={14} />}
				>
					Resolve
				</Button>
			</div>
		);
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
					icon={RefreshIcon}
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
						icon={Undo02Icon}
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

const CountryFocusEditor = memo(function CountryFocusEditor({
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
					onChange({ countryFocus })
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
});

/** Whether a record shows a DOI, in its DOI field or its Extra. */
const showsDoi = ({ DOI, extra }: Record<string, unknown>) =>
	Boolean(resolvePublicDoi({ DOI: typeof DOI === "string" ? DOI : null, extra: typeof extra === "string" ? extra : null }));

const OpenAccessEditor = memo(function OpenAccessEditor({
	value,
	fromDoi,
	fromSources,
	change,
	onChange,
	readOnly,
	error,
}: {
	value: unknown;
	fromDoi: boolean;
	fromSources: boolean | null;
	change: AdminDraftDiff["openAccess"];
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
							label="open access"
							publishedValue={describeOpenAccessChoice(change.previous)}
							onRevert={() => onChange({ openAccess: change.previous })}
						/>
					) : null
				}
			>
				Open access
			</FieldLabel>
			<OpenAccessInput
				disabled={readOnly}
				value={typeof value === "boolean" ? value : null}
				fromDoi={fromDoi}
				lookedUp={fromSources}
				onChange={(openAccess) => onChange({ openAccess })}
			/>
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
});

const StudyTypeEditor = memo(function StudyTypeEditor({
	value,
	reading,
	change,
	onChange,
	readOnly,
	error,
}: {
	value: unknown;
	reading: StudyReading | null;
	change: AdminDraftDiff["studyType"];
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
							label="study type"
							publishedValue={describeStudyTypeChoice(change.previous)}
							onRevert={() => onChange({ studyType: change.previous })}
						/>
					) : null
				}
			>
				Study type
			</FieldLabel>
			<StudyTypeInput
				disabled={readOnly}
				value={typeof value === "string" ? (value as StudyTypeKey) : null}
				reading={reading}
				onChange={(studyType) => onChange({ studyType })}
			/>
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
});

/** The draft's licence, or none when it holds none or one that can't be read. */
const recordLicence = (value: unknown) => recordLicenceSchema.safeParse(value).data ?? null;

/** Says why sending a record on is held while it is to get a DOI without a licence. The span keeps the held button hoverable. */
function LicenceHold({ missing, children }: { missing: boolean; children: ReactNode }) {
	return (
		<Tooltip content="Pick a licence first. A DOI needs one." isDisabled={!missing}>
			<span className="flex min-w-0 flex-1">{children}</span>
		</Tooltip>
	);
}

/** A record's licence, with what it needs to show and change it. Only records made here, which can get a DOI, have one. */
type RecordLicenceField = { value: RecordLicence | null; change: AdminDraftDiff["licence"]; defaultLicence: string; needed: boolean; onChange: (licence: RecordLicence | null) => void };

/** Under the Rights field, on a record that has a licence. */
const LicenceEditor = memo(function LicenceEditor({ id, field, licence, rights, readOnly }: { id: string; field: string; licence: RecordLicenceField | null; rights: string; readOnly: boolean }) {
	if (field !== "rights" || !licence) return null;
	return (
		<div className="space-y-1.5 pt-1.5">
			<FieldLabel
				htmlFor={id}
				action={
					licence.change && !readOnly ? (
						<ChangedMarker
							label="licence"
							publishedValue={licence.change.previous ? licenceLabel(licence.change.previous) : <span className="text-black/40 dark:text-white/40">None</span>}
							onRevert={() => licence.onChange(licence.change!.previous)}
						/>
					) : null
				}
			>
				Licence
			</FieldLabel>
			<LicenceInput
				id={id}
				value={licence.value}
				rights={rights}
				defaultLicence={licence.defaultLicence}
				needed={licence.needed}
				disabled={readOnly}
				onChange={licence.onChange}
			/>
		</div>
	);
});

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

/** The Item type box's text. The changed marker's revert changes the type from outside the box, so the text follows it. */
function useItemTypeInput(itemType: string | null) {
	const label = itemType ? humanizeAdminField(itemType) : "";
	const [input, setInput] = useState(label);
	const [shownLabel, setShownLabel] = useState(label);
	if (label !== shownLabel) {
		setShownLabel(label);
		setInput(label);
	}
	return [input, setInput] as const;
}

function MetadataEditor({
	definitions,
	detail,
	diff,
	errors,
	onChange,
	onFieldChange,
	payload,
	readOnly,
	doi: { locked: lockedDoi, registers: registersDoi, licence },
}: {
	definitions: readonly AdminSchemaDefinition[];
	detail: AdminItemDetail;
	diff: AdminDraftDiff;
	errors: AdminFieldErrors;
	onFieldChange: (field: string, value: string) => void;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	readOnly: boolean;
	doi: {
		/** A DOI from elsewhere that Zenodo reuses, which can't change while it is active. */
		locked: string | null;
		/** The community registers this record's DOI itself, so nothing outside lists it. */
		registers: boolean;
		/** Its licence, shown under its rights; null for a record that came from elsewhere. */
		licence: RecordLicenceField | null;
	};
}) {
	const definition = definitionFor(
		definitions,
		String(payload.itemType ?? detail.itemType),
	);
	const { titleField, countryFocusAfterField } = countryFocusPlacement(definition);
	const metadataFields = useMemo(() => adminFieldDescriptors(definition), [definition]);
	const countryTitle = useDeferredValue(payload[titleField]);
	const countryAbstract = useDeferredValue(payload.abstractNote);
	const countryPayload = useMemo(() => ({ [titleField]: countryTitle, abstractNote: countryAbstract, countryFocus: payload.countryFocus }), [titleField, countryTitle, countryAbstract, payload.countryFocus]);
	const selectedItemType = definition?.itemType ?? null;
	const [itemTypeInput, setItemTypeInput] = useItemTypeInput(selectedItemType);
	const updateField = onFieldChange;

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
							// The box also reports its current type when Tab or a click elsewhere leaves it.
							if (value !== selectedItemType) onChange({ ...payload, itemType: value });
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
			{metadataFields
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
								onFieldChange={onFieldChange}
							/>
							{field === countryFocusAfterField &&
								isTopLevelAdminItemType(
									String(payload.itemType ?? detail.itemType),
								) && (
									<>
										<CountryFocusEditor
											payload={countryPayload}
											titleField={titleField}
											change={diff.countryFocus}
											onChange={onChange}
											readOnly={readOnly}
											error={errors.countryFocus}
										/>
										<OpenAccessEditor
											value={payload.openAccess}
											fromDoi={!registersDoi && showsDoi(payload)}
											fromSources={detail.openAccessFromSources}
											change={diff.openAccess}
											onChange={onChange}
											readOnly={readOnly}
											error={errors.openAccess}
										/>
										<StudyTypeEditor
											value={payload.studyType}
											reading={detail.readingStudyType}
											change={diff.studyType}
											onChange={onChange}
											readOnly={readOnly}
											error={errors.studyType}
										/>
									</>
								)}
							<LicenceEditor id={`admin-${detail.key}-licence`} field={field} licence={licence} rights={value} readOnly={readOnly} />
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

const TagsEditor = memo(function TagsEditor({
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
	const libraryConfig = useLibraryConfig();
	const error = firstAdminFieldError(errors, "tags");
	const tags = Array.isArray(payload.tags)
		? payload.tags.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const visibleTags = ordinaryItemTags(tags, libraryConfig);
	const tag = value.trim();
	const alreadyAdded = hasTag(tags, tag);
	const addTag = () => {
		if (!tag || alreadyAdded) return;
		onChange({ ...payload, tags: [...tags, tag] });
		setValue("");
	};
	return (
		<div className="space-y-2">
			{visibleTags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{visibleTags.map((tag) => (
						<Chip
							key={tag}
							className="rounded-lg bg-black/[0.045] dark:bg-white/[0.06]"
							endContent={
								readOnly ? undefined : (
									<Button
										isIconOnly
										size="xs"
										variant="transparent"
										className="!h-5 !w-5 shrink-0 rounded-md text-black/45 dark:text-white/45"
										aria-label={`Remove tag ${tag}`}
										onPress={() =>
											onChange({
												...payload,
												tags: tags.filter(
													(entry) => entry !== tag,
												),
											})
										}
									>
										<HugeiconsIcon
											icon={Cancel01Icon}
											size={12}
											aria-hidden
										/>
									</Button>
								)
							}
							size="sm"
							variant="flat"
						>
							{tag}
						</Chip>
					))}
				</div>
			)}
			<Input
				color="filled"
				id={`admin-${recordKey}-tags`}
				isDisabled={readOnly}
				classNames={inspectorInputClassNames}
				endContent={
					<IconButton
						disabled={readOnly || !tag || alreadyAdded}
						icon={Add01Icon}
						label="Add tag"
						onPress={addTag}
					/>
				}
				placeholder="Add a tag"
				description={alreadyAdded ? "This tag is already added." : undefined}
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
		</div>
	);
});

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
				className={`space-y-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-danger ${
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
				) : null}
				{entries.length > 0 && (
					<ul className="space-y-1.5" aria-label="Selected collections">
						{entries.map((entry) => {
							const locked = entry.deleted || !editableSourceSet.has(entry.sourceConnectionKey);
							const membershipChanged = publishedCollectionKeys !== undefined && !publishedSelected.has(entry.key);
							return (
								<InspectorListRow
									key={entry.key}
									icon={Folder01Icon}
									title={entry.name}
									data-admin-collection-membership={entry.key}
									description={adminCollectionPath(entry, sources)}
									status={membershipChanged || entry.deleted ? (
										<>
											{membershipChanged && <span className="text-accent">Added in this draft</span>}
											{entry.deleted && <span className="text-warning">Deleted</span>}
										</>
									) : undefined}
									actions={locked ? (
										<HugeiconsIcon icon={SquareLock01Icon} aria-label="Read only" className="shrink-0 opacity-40" size={11} />
									) : !readOnly ? (
										<InspectorListRemove
											label={`Remove ${entry.name}, ${adminCollectionPath(entry, sources)}`}
											onRemove={() => onChange({ ...payload, collections: selectedKeys.filter(key => key !== entry.key) })}
										/>
									) : undefined}
								/>
							);
						})}
					</ul>
				)}
				<Button
					isDisabled={readOnly}
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
		<div className="space-y-2">
			{detail.attachments.length > 0 && (
				<ul className="space-y-1.5" aria-label="Attachments">
					{detail.attachments.map((attachment) => (
						<InspectorListRow
							key={attachment.key}
							icon={FileAttachmentIcon}
							title={attachment.title}
							onOpen={() => onSelectAttachment(attachment.key)}
							status={
								<>
									{!readOnlyVersion && <RecordStateChip state={attachment.state} />}
									{attachment.fileState !== "none" && <FileStateChip state={attachment.fileState} snapshot={readOnlyVersion} />}
								</>
							}
						/>
					))}
				</ul>
			)}
			<Button
				isDisabled={readOnly || busy}
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
		</div>
	);
}

function formatFileDetails(bytes: number, pages: number | null | undefined) {
	const size = bytes < 1024 * 102.4
		? `${Math.max(1, Math.round(bytes / 1024))} KB`
		: `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return pages ? `${pages} ${pages === 1 ? "page" : "pages"}, ${size}` : size;
}

function StagedAttachmentFile({
	file, sourceFileUrl, busy, readOnly, readOnlyVersion, onDiscardFile,
}: {
	file: NonNullable<AdminItemDetail["fileDraft"]>;
	sourceFileUrl: AdminItemDetail["sourceFileUrl"];
	busy: boolean;
	readOnly: boolean;
	readOnlyVersion: boolean;
	onDiscardFile: (key: string) => void;
}) {
	return (
		<div
			className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]"
			data-admin-file-row={
				file.readyAt ? "staged" : "processing"
			}
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-black/80 dark:text-white/80">
						{file.filename}
					</p>
					<p className="mt-1 text-black/45 dark:text-white/45">
						{formatFileDetails(file.expectedSizeBytes, file.pageCount)}
					</p>
				</div>
				<FileStateChip
					snapshot={readOnlyVersion}
					state={
						file.readyAt
							? "staged"
							: "processing"
					}
				/>
			</div>
			<p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-black/30 dark:text-white/30">
				{file.actualSha256 ??
					file.expectedSha256}
			</p>
			{readOnly &&
			file.readyAt &&
			sourceFileUrl ? (
				<Button
					as="a"
					href={sourceFileUrl}
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
						onPress={() => onDiscardFile(file.itemKey)}
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
						{file.readyAt
							? "Discard staged PDF"
							: "Cancel upload"}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function PublishedAttachmentFile({
	file, removalPending, busy, readOnly, onChangePdfRemoval,
}: {
	file: NonNullable<AdminItemDetail["filePublication"]>;
	removalPending: boolean;
	busy: boolean;
	readOnly: boolean;
	onChangePdfRemoval: (key: string) => void;
}) {
	return (
		<div
			className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]"
			data-admin-file-row="published"
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-black/80 dark:text-white/80">
						{file.filename}
					</p>
					<p className="mt-1 text-black/45 dark:text-white/45">
						{formatFileDetails(file.sizeBytes, file.pageCount)}
					</p>
				</div>
				<FileStateChip state="published" />
			</div>
			<p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-black/30 dark:text-white/30">
				{file.sha256}
			</p>
			<div className="mt-2 flex flex-wrap gap-1">
				<Button
					as="a"
					href={file.publicUrl}
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
						onPress={() => onChangePdfRemoval(file.itemKey)}
						size="xs"
						startContent={
							<HugeiconsIcon
								icon={
									removalPending
										? Undo02Icon
										: Delete02Icon
								}
								aria-hidden
								size={14}
							/>
						}
						variant="transparent"
					>
						{removalPending
							? "Undo removal"
							: "Remove PDF from draft"}
					</Button>
				) : null}
			</div>
		</div>
	);
}

/**
 * A note or an ordinary link, which readers see only when it carries one of its record's publish tags; read from
 * the payload being edited, so a draft that makes an attachment a link shows the link's rule.
 */
function taggedForPublic(detail: AdminItemDetail, payload: Record<string, unknown>) {
	if (detail.itemType === "Note") return true;
	return payload.linkMode === "linked_url" && String(payload.contentType ?? "").toLowerCase() !== "application/pdf";
}

/** Uploads a PDF the library keeps. A Zotero PDF is Zotero's file: a new one is added there, never uploaded here. */
function LibraryPdfUpload({ busy, detail, onUpload, readOnly }: {
	busy: boolean;
	detail: AdminItemDetail;
	onUpload: (key: string, file: File) => void;
	readOnly: boolean;
}) {
	if (detail.sourcePdf) return null;
	return (
		<div>
			<PdfFileInput
				attachmentKey={detail.key}
				disabled={readOnly || busy}
				label={detail.filePublication ? "Stage replacement" : "Upload PDF"}
				onUpload={onUpload}
			/>
		</div>
	);
}

/** The PDF its source holds, when the library publishes none: open it, and stage a Zotero one to publish it. */
function SourcePdfRow({ busy, detail, onStageSourcePdf, readOnly }: {
	busy: boolean;
	detail: AdminItemDetail & { sourceFileUrl: string };
	onStageSourcePdf?: (key: string) => void;
	readOnly: boolean;
}) {
	return (
		<div className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]" data-admin-file-row={detail.sourcePdf ? "source" : undefined}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<p className="font-medium text-black/80 dark:text-white/80">
						Source PDF
					</p>
					{detail.sourcePdf ? <SourcePdfReason sourcePdf={detail.sourcePdf} /> : null}
				</div>
				{detail.sourcePdf ? <FileStateChip state={detail.fileState} /> : null}
			</div>
			<div className="mt-2 flex flex-wrap gap-1">
				<Button
					as="a"
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
				{detail.sourcePdf?.applied && detail.sourcePdf.pdfsOn && !readOnly && onStageSourcePdf ? (
					<Button
						isDisabled={busy}
						onPress={() => onStageSourcePdf(detail.key)}
						size="xs"
						startContent={
							<HugeiconsIcon
								icon={CloudUploadIcon}
								aria-hidden
								size={14}
							/>
						}
						variant="transparent"
					>
						Stage PDF
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** Why a Zotero PDF isn't published: an editor took it down here, or it lacks one of its source's publish tags. */
function SourcePdfReason({ sourcePdf }: { sourcePdf: NonNullable<AdminItemDetail["sourcePdf"]> }) {
	if (!sourcePdf.pdfsOn)
		return <p className="mt-1 text-black/45 dark:text-white/45">PDFs are off for this source</p>;
	if (!sourcePdf.applied)
		return <p className="mt-1 text-black/45 dark:text-white/45">Changes on the next import</p>;
	if (sourcePdf.choice === "withhold")
		return <p className="mt-1 text-black/45 dark:text-white/45">Taken down in this community</p>;
	return (
		<p className="mt-1 flex flex-wrap items-center gap-1 text-black/45 dark:text-white/45">
			Publishes when tagged
			{(sourcePdf.publishTags ?? []).map((tag) => (
				<span key={tag} className="rounded bg-black/[0.05] px-1 font-mono text-[10px] text-black/60 dark:bg-white/[0.07] dark:text-white/60">{tag}</span>
			))}
		</p>
	);
}

function AttachmentFilePanel({
	busy,
	detail,
	fileError,
	onDiscardFile,
	onChangePdfRemoval,
	onStageSourcePdf,
	onUpload,
	readOnly,
	readOnlyVersion,
}: {
	busy: boolean;
	detail: AdminItemDetail;
	fileError?: string;
	onDiscardFile: (key: string) => void;
	onChangePdfRemoval: (key: string) => void;
	onStageSourcePdf?: (key: string) => void;
	onUpload: (key: string, file: File) => void;
	readOnly: boolean;
	readOnlyVersion: boolean;
}) {
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
			{detail.filePublication && (
				<PublishedAttachmentFile
					file={detail.filePublication}
					removalPending={detail.fileRemovalPending}
					busy={busy}
					readOnly={readOnly}
					onChangePdfRemoval={onChangePdfRemoval}
				/>
			)}
			{detail.fileDraft && (
				<StagedAttachmentFile
					file={detail.fileDraft}
					sourceFileUrl={detail.sourceFileUrl}
					busy={busy}
					readOnly={readOnly}
					readOnlyVersion={readOnlyVersion}
					onDiscardFile={onDiscardFile}
				/>
			)}
			{!detail.filePublication &&
			!detail.fileDraft &&
			detail.sourceFileUrl ? (
				<SourcePdfRow busy={busy} detail={{ ...detail, sourceFileUrl: detail.sourceFileUrl }} onStageSourcePdf={onStageSourcePdf} readOnly={readOnly} />
			) : null}

			<LibraryPdfUpload busy={busy} detail={detail} onUpload={onUpload} readOnly={readOnly} />
		</div>
	);
}

export function AdminInspector({
	conflictCount = 0,
	onResolveConflicts,
	readOnlyVersion = false,
	allowReviewCorrections = false,
	versionControls,
	versionBand,
	versionNotice,
	liveDetail,
	editorNotice,
	versionActions,
	versionStatus,
	versionWithdraw,
	actionsReady = true,
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
	preview,
	previewReview,
	onOpenDraft,
	onManageSources,
	onPublish,
	onPublicationChanged,
	onWritebackResolved,
	onReloadDraft,
	onRetry,
	onRestore,
	onUnpublish,
	onSelectAttachment,
	onStartLinkPick,
	onStopLinkPick,
	onChangePdfRemoval,
	onStageSourcePdf,
	onUpload,
	payload,
	saveMessage,
	saveState,
	sources,
	validationErrors = {},
	validationRevision = 0,
}: {
	conflictCount?: number;
	onResolveConflicts?: () => void;
	readOnlyVersion?: boolean;
	allowReviewCorrections?: boolean;
	versionControls?: ReactNode;
	/** The review's coloured band, pinned above the status menu's scrolling body. */
	versionBand?: ReactNode;
	/** What the review says beyond its band (conflicts, an editor's note), which scrolls with the body. */
	versionNotice?: ReactNode;
	liveDetail?: AdminItemDetail;
	editorNotice?: ReactNode;
	versionActions?: ReactNode;
	versionStatus?: ReactNode;
	versionWithdraw?: ReactNode;
	/** False until the record's review is read, so the actions arrive once, in their final place. */
	actionsReady?: boolean;
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
	onChange: (payload: SetStateAction<Record<string, unknown>>) => void;
	onCreateAttachment: () => void;
	onDiscardDraft: () => void;
	onDiscardFile: (key: string) => void;
	onDuplicate: () => void;
	/** The public page preview beside the editor. */
	preview: DraftPreview;
	previewReview?: PreviewReview;
	onOpenDraft: () => void;
	onManageSources: () => void;
	/** Sends the working draft on: to the review queue, or published at once by an Editor or Owner. */
	onPublish: (publish: boolean) => void;
	onPublicationChanged: (
		receipts?: readonly AdminSearchIndexReceipt[],
	) => Promise<void>;
	onWritebackResolved: (result: AdminSearchIndexMutationResult) => void;
	onReloadDraft: () => void;
	/** Reads the record again after a failure. Absent when the record no longer exists. */
	onRetry?: () => void;
	onRestore: () => void;
	onUnpublish: () => void;
	onSelectAttachment: (key: string) => void;
	onStartLinkPick?: (kind: AdminItemLinkKind) => void;
	onStopLinkPick?: () => void;
	onChangePdfRemoval: (key: string) => void;
	/** Stages a Zotero attachment's own PDF to publish. */
	onStageSourcePdf?: (key: string) => void;
	onUpload: (key: string, file: File) => void;
	payload: Record<string, unknown>;
	saveMessage: string | null;
	saveState: SaveState;
	sources: AdminSource[];
	validationErrors: AdminFieldErrors;
	validationRevision: number;
}) {
	const libraryConfig = useLibraryConfig();
	const { identity, topics: topicsConfig } = libraryConfig;
	const { canPublish, defaultLicence } = useAdminSession();
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

	const patchPayload = useCallback((patch: Record<string, unknown>) => {
		// Section editors patch a slice of the payload, so keys they leave undefined must not stay in the draft.
		onChange((current) =>
			Object.fromEntries(
				Object.entries({ ...current, ...patch }).filter(
					([, value]) => value !== undefined,
				),
			),
		);
	}, [onChange]);
	const changeField = useCallback((field: string, value: string) => {
		patchPayload({ [field]: value });
	}, [patchPayload]);
	const creatorsPayload = useMemo(() => ({ creators: payload.creators }), [payload.creators]);
	const tagsPayload = useMemo(() => ({ tags: payload.tags }), [payload.tags]);
	const collectionsPayload = useMemo(() => ({ collections: payload.collections }), [payload.collections]);
	const linksPayload = useMemo(() => ({ links: payload.links }), [payload.links]);
	const topicIds = Array.isArray(payload.topics)
		? payload.topics.filter((topic): topic is string => topicIdSchema.safeParse(topic).success)
		: [];
	const sourceResolutions = payload.sourceResolutions && typeof payload.sourceResolutions === "object" && !Array.isArray(payload.sourceResolutions)
		? payload.sourceResolutions as Record<string, SourceResolution>
		: {};

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
				{error && onRetry ? (
					<Button onPress={onRetry} size="xs">
						Try again
					</Button>
				) : null}
			</div>
		);
	}

	const tagsForEditor = (tags: string[]) => ordinaryItemTags(tags, libraryConfig);
	const native = detail.sourceConnectionKey === NATIVE_SOURCE_CONNECTION_KEY;
	const importedOpenAlex = detail.kind === "imported" && detail.writeback.available.some(
		(target) => target.isOrigin && isOpenAlexWorkProvider(target.provider),
	);
	const isAttachment = detail.itemType.toLowerCase() === "attachment";
	const unrestored = isUnrestoredRecord(detail);
	// Only a record made here can get a DOI, and a DOI needs a licence: Zenodo and Crossref both take it.
	const doiChosen = Boolean(readOnlyVersion ? publishingChoice : publishing?.saved.data?.choice);
	const licenceField: RecordLicenceField | null =
		detail.kind === "created" && !detail.parentItem
			? { value: recordLicence(payload.licence), change: diff.licence, defaultLicence, needed: doiChosen, onChange: (licence) => patchPayload({ licence }) }
			: null;
	const licenceMissing = Boolean(licenceField?.needed && !licenceComplete(licenceField.value));
	// OpenAlex records take library files because OpenAlex gets no writeback; Zotero attachments sync back to Zotero.
	const holdsLibraryFiles =
		native ||
		(!isAttachment && isOpenAlexWorkProvider(sources.find((source) => source.key === detail.sourceConnectionKey)?.provider));
	// A Zotero PDF's changes go into the working draft whatever writeback allows the record itself, until a review holds them.
	const filesReadOnly = readOnlyVersion || unrestored || (detail.sourcePdf ? detail.sourcePdf.inReview : !holdsLibraryFiles || !detail.draft || !detail.editable);
	const sourcePdfChange = !readOnlyVersion && detail.sourcePdfChangePending;
	const editable =
		(allowReviewCorrections || (!readOnlyVersion && detail.editable)) &&
		Boolean(detail.draft) &&
		!busy;
	const readOnly = !editable;
	const liveRecord = liveDetail?.key === detail.key ? liveDetail : detail;
	const recordSource = sources.find((source) => source.key === liveRecord.sourceConnectionKey);
    const originWritebackReason = liveRecord.writeback.available.find(
        target => target.sourceKey === liveRecord.writeback.originSourceKey,
    )?.reason;
    const writebackRestriction = !readOnlyVersion && !liveRecord.editable && liveRecord.state !== "deleted" && originWritebackReason && originWritebackReason !== "ok"
        ? writebackUnavailableMessage[originWritebackReason] : null;
	const itemUrl = buildAdminPublicItemUrl(liveRecord, identity.baseUrl);
	// The paper's page on Openscholar, for a record an OpenAlex source holds.
	const openScholarPaperUrl = detail.openalexId ? new URL(`/papers/${detail.openalexId}`, libraryConfig.authentication.openScholar.siteUrl).toString() : null;
	const restoring =
		detail.state === "deleted" &&
		(Boolean(detail.parentItem) || !detail.draft);
	// An attachment acts like its record: Edit, then Send to queue or Publish, which sends the record with it. One it can't
	// change has no main action.
	const showPrimaryAction = !detail.parentItem || detail.editable || sourcePdfChange;
	const primaryKey =
		sourcePdfChange && !detail.draft
			? "submit"
			: !detail.editable && !readOnlyVersion
			? "duplicate"
			: restoring
				? "restore"
				: !detail.draft
					? "edit"
					: "submit";
	const primaryAction = {
		duplicate: { label: "Duplicate as native", icon: Copy01Icon, onPress: onDuplicate },
		restore: { label: "Restore", icon: ArchiveRestoreIcon, onPress: onRestore },
		edit: { label: "Edit", icon: PencilIcon, onPress: onOpenDraft },
		submit: { label: "Send to queue", icon: InboxIcon, onPress: () => onPublish(false) },
	}[primaryKey];
	// An Editor or Owner sends a version to the review queue, or publishes it at once.
	const choosesPublish = primaryKey === "submit" && canPublish;
	const primaryDisabled =
		busy ||
		readOnlyVersion ||
		(sourcePdfChange && reviewPending) ||
		(Boolean(detail.draft) &&
			(saveState === "saving" ||
				saveState === "conflict" ||
				saveState === "error" ||
				reviewPending ||
				submissionBlocked)) ||
		licenceMissing;
  const hasPublishedVersion = Boolean(liveRecord.published) && liveRecord.state !== "deleted";
  const showPublicLinkActions = hasPublishedVersion && Boolean(itemUrl);
  const openPublicationSettings = () => {
    closeMenu();
    const toggle = document.getElementById(`admin-${detail.key}-identifiers-toggle`);
    if (toggle?.getAttribute("aria-expanded") !== "true") toggle?.click();
    document.getElementById("admin-doi-publishing")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

	return (
		<div
			className="flex h-full min-h-0 flex-col [@media(max-height:600px)]:overflow-y-auto"
			data-admin-region="inspector"
		>
			{versionControls}
			<DraftPreviewPortal
				preview={preview}
				itemKey={detail.parentItem ?? detail.key}
				review={previewReview}
				saving={saveState === "saving"}
			/>
			<AdminDocumentHeader
				publicActions={
					<ButtonGroup className={ADMIN_BUTTON_GROUP}>
						<Tooltip content={preview.open ? "Hide preview" : "Preview"}>
							<Button
								aria-label={preview.open ? "Hide preview" : "Preview"}
								aria-pressed={preview.open}
								isIconOnly
								onPress={preview.onToggle}
								onPointerEnter={preview.onPrepare}
								onFocus={preview.onPrepare}
								size="xs"
								variant="transparent"
								className={`${ADMIN_GROUP_BUTTON} aria-pressed:bg-accent/15 aria-pressed:text-accent`}
							>
								<HugeiconsIcon icon={ViewIcon} aria-hidden size={14} />
							</Button>
						</Tooltip>
						{showPublicLinkActions && (
							<Tooltip content="Open public item">
								<Button
									as="a"
									aria-label="Open public item"
									href={itemUrl ?? undefined}
									target="_blank"
									rel="noreferrer"
									isIconOnly
									size="xs"
									variant="transparent"
									className={`${ADMIN_GROUP_BUTTON} ${ADMIN_GROUP_DIVIDER}`}
								>
									<HugeiconsIcon icon={LinkSquare01Icon} aria-hidden size={14} />
								</Button>
							</Tooltip>
						)}
						{openScholarPaperUrl && (
							<Tooltip content="Open in Openscholar">
								<Button
									as="a"
									aria-label="Open in Openscholar"
									href={openScholarPaperUrl}
									target="_blank"
									rel="noreferrer"
									isIconOnly
									size="xs"
									variant="transparent"
									className={`${ADMIN_GROUP_BUTTON} ${ADMIN_GROUP_DIVIDER}`}
								>
									{/* Its own title would show as the browser's tooltip beside this one. */}
									<OpenScholar monochrome aria-hidden className="pointer-events-none size-3.5" />
								</Button>
							</Tooltip>
						)}
						{showPublicLinkActions && (
							<Tooltip content="Copy public item link">
								<Button
									aria-label="Copy public item link"
									isIconOnly
									size="xs"
									variant="transparent"
									className={`${ADMIN_GROUP_BUTTON} ${ADMIN_GROUP_DIVIDER}`}
									onPress={() => {
										if (itemUrl)
											void navigator.clipboard
												.writeText(itemUrl)
												.then(() => toast.success("Item link copied"))
												.catch(() => toast.error("Could not copy item link"));
									}}
								>
									<HugeiconsIcon icon={Copy01Icon} aria-hidden size={14} />
								</Button>
							</Tooltip>
						)}
					</ButtonGroup>
				}
				menuOpen={menuOpen}
				onMenuOpenChange={setMenuOpen}
				detail={detail}
				cover={
					// The badge sits on the cover's corner, so the cover and the badge share one box.
					<div className="relative shrink-0">
					<AdminPdfCover
						detail={detail}
						submitted={readOnlyVersion}
						reviewId={reviewId}
						disabled={
							!detail.draft ||
							readOnlyVersion ||
							!detail.editable ||
							unrestored ||
							(isAttachment && !native) ||
							busy
						}
						progress={readOnlyVersion ? undefined : pdfProgress}
						error={
							readOnlyVersion ? undefined : fileErrors[detail.key]
						}
						onUpload={onAddPdf}
					/>
					<ImportChecksBadge checks={detail.importChecks} payload={payload} />
					</div>
				}
				status={
					versionStatus ?? <RecordStateChip state={detail.state} />
				}
				saveIndicator={
					<SaveIndicator
						conflictCount={conflictCount}
						onResolveConflicts={onResolveConflicts}
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
					<AdminRecordStatusMenu
						header={versionBand ? <section aria-label="Review status">{versionBand}</section> : null}
 restriction={writebackRestriction || undefined}
						canLoadRemote={!detail.parentItem}
						itemKey={detail.key}
						key={detail.key}
						onResolved={onWritebackResolved}
						revision={liveRecord.revision}
						sources={liveRecord.writeback.selected.map(
							(sourceKey) => {
								const target =
									liveRecord.writeback.available.find(
										(candidate) =>
											candidate.sourceKey === sourceKey,
									);
								return {
									provider: target?.provider ?? "zotero",
									sourceKey,
									sourceLabel:
										target?.sourceLabel ?? sourceKey,
								};
							},
						)}
						manageAction={
							!readOnlyVersion &&
							!detail.parentItem &&
							liveRecord.writeback.available.length > 0 ? (
								<Button
									data-admin-writeback-sources-button
									aria-label="Manage sources"
									size="xs"
									variant="muted"
									className="h-9 min-w-0 rounded-xl px-3 text-xs"
									isDisabled={busy || !canPublish}
									onPress={() => {
										closeMenu();
										onManageSources();
									}}
								>
									Manage
								</Button>
							) : undefined
						}
						footer={
							<div className="flex w-full flex-wrap items-center gap-2 [&_button]:h-9 [&_button]:rounded-xl [&_button]:text-xs">
								{!readOnlyVersion &&
									detail.draft && (
											<Button
												aria-label={
													detail.published
														? "Discard changes"
														: "Delete draft"
												}
												size="xs"
												variant="muted"
												color="danger"
												isDisabled={
													busy ||
													(reviewPending &&
														!detail.published)
												}
												onPress={() => {
													closeMenu();
													onDiscardDraft();
												}}
												startContent={
													<HugeiconsIcon
														icon={Delete02Icon}
														size={13}
													/>
												}
											>
												{detail.published
													? "Discard changes"
													: "Delete draft"}
											</Button>
										)}
                                {!readOnlyVersion && canPublish && (native || importedOpenAlex) && detail.editable && detail.published && detail.state !== "deleted" && (
                                    <Button size="xs" variant="muted" color="danger" isDisabled={busy}
                                        onPress={() => { closeMenu(); onUnpublish(); }}
                                        startContent={<HugeiconsIcon icon={ArchiveIcon} aria-hidden size={14} />}>
                                        Unpublish
                                    </Button>
                                )}
							</div>
						}
					>
						{!versionBand && (
							<section aria-label="Review status">
								<RecordStateChip state={detail.state} />
							</section>
						)}
						{versionNotice}
						{!detail.parentItem && (
							<AdminItemDisplay
								publishedDetail={liveRecord}
								publicationStatus={
									publication.publication ? (
										<AdminPublicationHeaderStatus
											onPress={openPublicationSettings}
											state={publication}
										/>
									) : (
										<Button
											size="xs"
											variant="transparent"
											startContent={
												<HugeiconsIcon
													icon={Link02Icon}
													size={13}
												/>
											}
											className="h-8 min-w-0 max-w-[150px] gap-2 rounded-lg px-0 text-xs text-black/65 dark:text-white/70"
											onPress={openPublicationSettings}
											endContent={
												<HugeiconsIcon
													icon={ArrowRight01Icon}
													size={12}
													className="shrink-0"
												/>
											}
										>
											<TruncatedText
												text={
													publication.error
														? "Status unavailable"
														: publication.isLoading
															? "Loading…"
															: String(
																	liveRecord
																		.published
																		?.DOI ||
																		"No DOI",
																)
												}
											/>
										</Button>
									)
								}
								title={String(payload.title || detail.title)}
								tags={
									Array.isArray(payload.tags)
										? payload.tags.filter(
												(tag): tag is string =>
													typeof tag === "string",
											)
										: []
								}
								readOnly={readOnly}
								onChange={(tags) =>
									patchPayload({ tags })
								}
							/>
						)}
						{detail.parentItem && (
							<AttachmentDisplay
								tags={Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : []}
								readOnly={readOnly}
								onChange={(tags) => patchPayload({ tags })}
								publishTags={taggedForPublic(detail, payload) ? recordPublishTags(libraryConfig.sourcePublishTags, detail.sourceConnectionKey) : undefined}
							/>
						)}
						{detail.parentItem && (
							<span className="flex items-center gap-1.5 text-[11px] text-black/45 dark:text-white/45">
								<HugeiconsIcon
									icon={CheckmarkBadge01Icon}
									size={13}
								/>
								{hasPublishedVersion
									? `Published revision ${liveRecord.revision}`
									: "Not published"}
							</span>
						)}
					</AdminRecordStatusMenu>
				}

				actions={
					actionsReady && (
					<div className="flex min-w-0 flex-1 animate-fade-in items-center gap-2">
						{versionActions ??
							(showPrimaryAction && (
								<LicenceHold missing={licenceMissing}>
								<Button
									size="xs"
									// Beside Publish, sending to the queue is the quieter choice.
									color={
										primaryDisabled || choosesPublish ? "secondary" : "accent"
									}
									variant={
										primaryDisabled || choosesPublish ? "muted" : "solid"
									}
									className="h-9 min-w-0 flex-1 gap-1.5 rounded-xl px-3 font-semibold"
									isDisabled={primaryDisabled}
									onPress={primaryAction.onPress}
									startContent={
										<HugeiconsIcon
											icon={primaryAction.icon}
											size={14}
										/>
									}
								>
									{primaryAction.label}
								</Button>
								</LicenceHold>
							))}
						{!versionActions && showPrimaryAction && choosesPublish && (
							<LicenceHold missing={licenceMissing}>
							<Button
								size="xs"
								color={primaryDisabled ? "secondary" : "accent"}
								variant={primaryDisabled ? "muted" : "solid"}
								className="h-9 min-w-0 flex-1 gap-1.5 rounded-xl px-3 font-semibold"
								isDisabled={primaryDisabled}
								onPress={() => onPublish(true)}
								startContent={<HugeiconsIcon icon={CheckmarkBadge01Icon} size={14} />}
							>
								Publish
							</Button>
							</LicenceHold>
						)}
						{versionWithdraw}
					</div>
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
						{onRetry && (
							<Button
								onPress={onRetry}
								size="xs"
								variant="transparent"
							>
								Retry
							</Button>
						)}
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
				{!(onResolveConflicts && conflictCount > 0) && (
					<ValidationSummary
						errors={validationErrors}
						recordKey={detail.key}
						tone={
							saveState === "conflict" ? "conflict" : "validation"
						}
					/>
				)}
				{editorNotice}
				{!detail.parentItem ? (
					<Section
						icon={CheckmarkBadge01Icon}
						id="admin-doi-publishing"
						title="Identifiers"
					>
						{publishing && (
							<RecordDoiPanel
								detail={detail}
								readOnly={readOnlyVersion || readOnly}
								filesReadOnly={filesReadOnly}
								choice={
									readOnlyVersion
										? (publishingChoice ?? null)
										: undefined
								}
								model={publishing}
								licenceMissing={licenceMissing}
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
 onFieldChange={changeField}
						key={detail.key}
						definitions={definitions}
						detail={detail}
						diff={diff}
						errors={validationErrors}
						onChange={patchPayload}
						payload={payload}
						readOnly={readOnly}
						doi={{
							// Until a record made here is known to have no DOI choice, it counts as registering its own.
							registers: readOnlyVersion ? Boolean(publishingChoice) : detail.kind === "created" && publishing?.saved.data?.choice !== null,
							licence: licenceField,
							locked:
								publication.publication?.providers.zenodo.exact
									.targetActive &&
								publication.publication.providers.zenodo.exact
									.identifierPolicy === "reuse-external"
									? (publication.publication.identifiers.doi
											?.value ?? null)
									: null,
						}}
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
							onChange={patchPayload}
							payload={creatorsPayload}
							readOnly={readOnly}
							recordKey={detail.key}
						/>
					</Section>
				) : null}

				<Section
					actions={
						diff.tags &&
						JSON.stringify(
							tagsForEditor(diff.tags).sort(),
						) !==
							JSON.stringify(
								tagsForEditor((payload.tags ?? []) as string[]).sort(),
							) ? (
							<ChangedMarker
								label="tags"
								onRevert={() =>
									onChange({
										...payload,
										tags: [
											...tagsForEditor(diff.tags ?? []),
											...(
												(payload.tags ?? []) as string[]
											).filter(
												(tag) =>
													!tagsForEditor([tag]).length,
											),
										],
									})
								}
								publishedValue={
									<PublishedList
										values={tagsForEditor(diff.tags)}
									/>
								}
							/>
						) : undefined
					}
					icon={Tag01Icon}
					title="Tags"
				>
					<TagsEditor
						errors={validationErrors}
						onChange={patchPayload}
						payload={tagsPayload}
						readOnly={readOnly}
						recordKey={detail.key}
					/>
					</Section>
					{detail.sourceFields.some((field) => field.conflicting) ? (
						<Section icon={AlertCircleIcon} id="admin-source-conflicts" title="Source changes">
							<SourceConflictEditor
								fields={detail.sourceFields}
								importedTopics={detail.importedTopics}
								onChange={(resolutions) => patchPayload({ sourceResolutions: resolutions })}
								readOnly={readOnly}
								resolutions={sourceResolutions}
							/>
						</Section>
					) : null}
					{topicsConfig.enabled && !detail.parentItem ? (
						<Section icon={TagsIcon} id="admin-topics" title="Topics">
							<TopicsEditor
								importedTopics={detail.importedTopics}
								readOnly={readOnly}
								topics={topicIds}
								onChange={(topics) => patchPayload({ topics })}
							/>
						</Section>
					) : null}
					{!detail.parentItem ? (
					<AdminLinksEditor
						key={detail.key}
						actions={diff.links ? (
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
						detail={detail}
						errors={validationErrors}
						knownTargets={linkTargets}
						onChange={patchPayload}
						onOpenRecord={onBackToParent}
						onStartPick={onStartLinkPick}
						onStopPick={onStopLinkPick}
						payload={linksPayload}
						pickingKind={linkPickKind}
						readOnly={readOnly}
						sources={sources}
					/>
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
							onChange={patchPayload}
							payload={collectionsPayload}
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
							onStageSourcePdf={onStageSourcePdf}
							onUpload={onUpload}
							readOnly={filesReadOnly}
							readOnlyVersion={readOnlyVersion}
						/>
					) : (
						<AttachmentList
							busy={busy}
							detail={detail}
							onCreateAttachment={onCreateAttachment}
							onSelectAttachment={onSelectAttachment}
							readOnly={filesReadOnly}
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
							<dd className="flex min-w-0 items-center gap-1.5 font-medium text-black/70 dark:text-white/75">
								{recordSource ? (
									<SourceProviderIcon
										className="shrink-0"
										provider={recordSource.provider}
										size={13}
									/>
								) : null}
								{/* The key stands in until the library's sources load. */}
								<TruncatedText text={recordSource?.label ?? humanizeAdminField(liveRecord.sourceConnectionKey)} />
							</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-black/40 dark:text-white/40">
								Published revision
							</dt>
							<dd className="font-medium text-black/70 dark:text-white/75">
								{liveRecord.revision}
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
