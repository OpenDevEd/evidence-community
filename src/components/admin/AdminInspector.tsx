"use client";

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
	Spinner,
} from "@nextui-org/react";
import {
	AlertCircle,
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	BadgeCheck,
	Building2,
	Check,
	ChevronRight,
	Copy,
	Download,
	Eye,
	ExternalLink,
	FilePenLine,
	FilePlus2,
	FileText,
	Folder,
	History,
	Link2,
	Lock,
	Paperclip,
	Pencil,
	Plus,
	RotateCcw,
	Send,
	Tag,
	Trash2,
	Upload,
	UserRound,
	Users,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Autocomplete } from "@/components/nextui/Autocomplete";
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
import { AdminSourceWritebackStatus } from "./AdminSourceWritebackStatus";
import { useAdminSourceWriteback } from "./useAdminSourceWriteback";
import {
	computeAdminDraftDiff,
	EMPTY_ADMIN_DRAFT_DIFF,
	type AdminDraftDiff,
} from "./admin-diff";
import {
	adminFieldDescriptors,
	type AdminSchemaDefinition,
	creatorDisplayName,
	definitionFor,
	humanizeAdminField,
} from "./admin-schema";
import { firstAdminFieldError, validationTargetId } from "./admin-validation";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";
import { AdminLinksEditor } from "./AdminLinksEditor";
import { AdminMetadataField } from "./AdminMetadataField";
import {
	AdminPublicationHeaderStatus,
	AdminPublicationStatus,
} from "./AdminPublicationStatus";
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
	inputWrapper: "h-10 min-h-10 rounded-xl",
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
					<Pencil aria-hidden size={11} strokeWidth={2} />
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
						startContent={<RotateCcw aria-hidden size={13} />}
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
	icon: typeof Plus;
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
					<Icon aria-hidden size={14} />
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
	icon: typeof Plus;
	id?: string;
	title: string;
}) {
	return (
		<section className="scroll-mt-4 py-5 first:pt-0" id={id}>
			<div className="mb-3 flex min-h-6 items-center gap-2.5">
				<Icon
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
			aria-live={
				state === "error" || state === "conflict"
					? "assertive"
					: "polite"
			}
			className={`flex items-center gap-1.5 text-[11px] ${
				state === "error" || state === "conflict"
					? "text-danger"
					: "text-black/40 dark:text-white/40"
			}`}
			role={
				state === "error" || state === "conflict" ? "alert" : "status"
			}
		>
			{state === "saving" ? (
				<Spinner size="sm" />
			) : state === "saved" ? (
				<Check aria-hidden size={12} />
			) : (
				<X aria-hidden size={12} />
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
					icon={RotateCcw}
					label="Reload server draft"
					onPress={onReload}
				/>
			) : null}
		</div>
	);
}

function ValidationSummary({
	errors,
	recordKey,
}: {
	errors: AdminFieldErrors;
	recordKey: string;
}) {
	const entries = Object.entries(errors);
	if (entries.length === 0) return null;
	return (
		<div
			id={`admin-${recordKey}-validation-summary`}
			className="mt-3 rounded-xl bg-danger/[0.08] px-3 py-2.5 text-xs text-danger outline-none focus-visible:ring-2 focus-visible:ring-danger"
			role="alert"
			tabIndex={-1}
		>
			<div className="flex items-center gap-2 font-medium">
				<AlertCircle aria-hidden size={14} />
				Fix {entries.length} {entries.length === 1 ? "field" : "fields"}{" "}
				before publishing.
			</div>
			<ul className="mt-1.5 space-y-1 pl-5">
				{entries.map(([path, message]) => {
					const targetId = validationTargetId(recordKey, path);
					return (
						<li key={path}>
							{targetId ? (
								<button
									className="text-left underline decoration-danger/40 underline-offset-2 hover:decoration-danger"
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

function MetadataEditor({
	definitions,
	detail,
	diff,
	errors,
	onChange,
	payload,
	readOnly,
}: {
	definitions: readonly AdminSchemaDefinition[];
	detail: AdminItemDetail;
	diff: AdminDraftDiff;
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	readOnly: boolean;
}) {
	const definition = definitionFor(
		definitions,
		String(payload.itemType ?? detail.itemType),
	);
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
						listboxWrapper: "max-h-[320px]",
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
					</div>
				);
			})}
		</div>
	);
}

function CreatorsEditor({
	definition,
	errors,
	onChange,
	payload,
	readOnly,
}: {
	definition: AdminSchemaDefinition | undefined;
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	readOnly: boolean;
}) {
	const creators = Array.isArray(payload.creators)
		? (payload.creators as AdminCreator[])
		: [];
	const updateCreators = (next: AdminCreator[]) =>
		onChange({ ...payload, creators: next });
	const patchCreator = (index: number, patch: Partial<AdminCreator>) =>
		updateCreators(
			creators.map((creator, creatorIndex) =>
				creatorIndex === index ? { ...creator, ...patch } : creator,
			),
		);
	const replaceCreator = (index: number, replacement: AdminCreator) =>
		updateCreators(
			creators.map((creator, creatorIndex) =>
				creatorIndex === index ? replacement : creator,
			),
		);
	const moveCreator = (
		index: number,
		targetIndex: number,
		direction: "down" | "up",
	) => {
		const next = [...creators];
		[next[targetIndex], next[index]] = [next[index]!, next[targetIndex]!];
		updateCreators(next);
		requestAnimationFrame(() => {
			const action = document.getElementById(
				`admin-creator-${targetIndex}-move-${direction}`,
			);
			if (
				action instanceof HTMLButtonElement &&
				!action.disabled &&
				action.getAttribute("aria-disabled") !== "true"
			) {
				action.focus();
				return;
			}
			document.getElementById(`admin-creator-${targetIndex}`)?.focus();
		});
	};

	return (
		<div className="space-y-3">
			{creators.length === 0 ? (
				<EmptyValue label="No creators" />
			) : null}
			{creators.map((creator, index) => {
				const organization = typeof creator.name === "string";
				const rowError = errors[`creators.${index}`];
				const roleError = errors[`creators.${index}.creatorType`];
				const organizationError = errors[`creators.${index}.name`];
				const firstNameError = errors[`creators.${index}.firstName`];
				const lastNameError = errors[`creators.${index}.lastName`];
				const rowErrorId = `admin-creator-${index}-error`;
				return (
					<div
						key={index}
						aria-describedby={rowError ? rowErrorId : undefined}
						aria-label={`Creator ${index + 1}`}
						id={`admin-creator-${index}`}
						role="group"
						tabIndex={-1}
						className={`rounded-xl bg-black/[0.03] p-3 outline-none focus-visible:ring-2 focus-visible:ring-focus dark:bg-white/[0.04] ${
							rowError ? "ring-1 ring-danger/60" : ""
						}`}
					>
						<div className="mb-2 flex items-center gap-2">
							<Select
								aria-label={`Creator ${index + 1} role`}
								className="max-w-none flex-1"
								classNames={inspectorSelectClassNames}
								errorMessage={roleError}
								id={`admin-creator-${index}-role`}
								isDisabled={readOnly}
								isInvalid={Boolean(roleError)}
								placement="left"
								selectedKeys={new Set([creator.creatorType])}
								size="sm"
								onSelectionChange={(keys) => {
									const value = [...keys][0];
									if (typeof value === "string") {
										patchCreator(index, {
											creatorType: value,
										});
									}
								}}
							>
								{(definition?.creatorTypes ?? []).map(
									(role) => (
										<SelectItem key={role.creatorType}>
											{humanizeAdminField(
												role.creatorType,
											)}
										</SelectItem>
									),
								)}
							</Select>
							<IconButton
								disabled={readOnly}
								icon={organization ? UserRound : Building2}
								label={
									organization
										? "Use person name"
										: "Use organisation name"
								}
								onPress={() => {
									const next = { ...creator };
									if (organization) {
										delete next.name;
										next.firstName = "";
										next.lastName = creator.name ?? "";
									} else {
										next.name = creatorDisplayName(creator);
										delete next.firstName;
										delete next.lastName;
									}
									replaceCreator(index, next);
								}}
							/>
							<IconButton
								buttonId={`admin-creator-${index}-move-up`}
								disabled={readOnly || index === 0}
								icon={ArrowUp}
								label="Move creator up"
								onPress={() =>
									moveCreator(index, index - 1, "up")
								}
							/>
							<IconButton
								buttonId={`admin-creator-${index}-move-down`}
								disabled={
									readOnly || index === creators.length - 1
								}
								icon={ArrowDown}
								label="Move creator down"
								onPress={() =>
									moveCreator(index, index + 1, "down")
								}
							/>
							<IconButton
								disabled={readOnly}
								icon={Trash2}
								label="Remove creator"
								onPress={() =>
									updateCreators(
										creators.filter(
											(_, creatorIndex) =>
												creatorIndex !== index,
										),
									)
								}
							/>
						</div>
						{organization ? (
							<div className="space-y-1.5">
								<FieldLabel
									htmlFor={`admin-creator-${index}-organisation`}
								>
									Organisation
								</FieldLabel>
								<Input
									aria-label="Organisation"
									classNames={inspectorInputClassNames}
									errorMessage={organizationError}
									id={`admin-creator-${index}-organisation`}
									isInvalid={Boolean(
										rowError || organizationError,
									)}
									isDisabled={readOnly}
									value={creator.name ?? ""}
									onValueChange={(name) =>
										patchCreator(index, { name })
									}
								/>
							</div>
						) : (
							<div className="grid grid-cols-2 gap-2">
								<div className="space-y-1.5">
									<FieldLabel
										htmlFor={`admin-creator-${index}-first-name`}
									>
										First name
									</FieldLabel>
									<Input
										aria-label="First name"
										classNames={inspectorInputClassNames}
										errorMessage={firstNameError}
										id={`admin-creator-${index}-first-name`}
										isInvalid={Boolean(
											rowError || firstNameError,
										)}
										isDisabled={readOnly}
										value={creator.firstName ?? ""}
										onValueChange={(firstName) =>
											patchCreator(index, {
												firstName,
											})
										}
									/>
								</div>
								<div className="space-y-1.5">
									<FieldLabel
										htmlFor={`admin-creator-${index}-last-name`}
									>
										Last name
									</FieldLabel>
									<Input
										aria-label="Last name"
										classNames={inspectorInputClassNames}
										errorMessage={lastNameError}
										id={`admin-creator-${index}-last-name`}
										isInvalid={Boolean(
											rowError || lastNameError,
										)}
										isDisabled={readOnly}
										value={creator.lastName ?? ""}
										onValueChange={(lastName) =>
											patchCreator(index, {
												lastName,
											})
										}
									/>
								</div>
							</div>
						)}
						{rowError ? (
							<p
								id={rowErrorId}
								className="mt-2 text-xs text-danger"
							>
								{rowError}
							</p>
						) : null}
					</div>
				);
			})}
			{!readOnly && definition?.creatorTypes.length ? (
				<Button
					className="bg-black/[0.035] font-medium hover:bg-black/[0.06] dark:bg-white/[0.045] dark:hover:bg-white/[0.08]"
					onPress={() =>
						updateCreators([
							...creators,
							{
								creatorType:
									definition.creatorTypes.find(
										(role) => role.primary,
									)?.creatorType ??
									definition.creatorTypes[0]!.creatorType,
								firstName: "",
								lastName: "",
							},
						])
					}
					size="xs"
					startContent={<Plus aria-hidden size={14} />}
					variant="transparent"
				>
					Add creator
				</Button>
			) : null}
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
					id={`admin-${recordKey}-tags`}
					classNames={inspectorInputClassNames}
					endContent={
						<IconButton
							disabled={!value.trim()}
							icon={Plus}
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
						<AlertCircle
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
						<Spinner label="Loading collections" size="sm" />
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
							<Folder
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
									<Pencil
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
								<Lock
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
									<X aria-hidden size={13} />
								</button>
							) : null}
						</div>
					);
				})}
				{!readOnly ? (
					<Button
						onPress={() => setPickerOpen(true)}
						size="xs"
						startContent={<Plus aria-hidden size={13} />}
						variant="transparent"
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

function PdfFileInput({
	attachmentKey,
	disabled,
	label = "Upload PDF",
	onUpload,
}: {
	attachmentKey: string;
	disabled?: boolean;
	label?: string;
	onUpload: (attachmentKey: string, file: File) => void;
}) {
	const inputId = `pdf-${attachmentKey}`;
	return (
		<>
			<input
				id={inputId}
				accept="application/pdf,.pdf"
				className="sr-only"
				disabled={disabled}
				type="file"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) onUpload(attachmentKey, file);
					event.currentTarget.value = "";
				}}
			/>
			<label
				aria-disabled={disabled}
				className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-black/[0.035] px-3 text-xs font-medium text-black/65 transition-colors dark:bg-white/[0.045] dark:text-white/70 ${
					disabled
						? "pointer-events-none opacity-50"
						: "hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
				}`}
				htmlFor={inputId}
			>
				<Upload aria-hidden size={14} />
				{label}
			</label>
		</>
	);
}

function AttachmentList({
	busy,
	detail,
	onCreateAttachment,
	onSelectAttachment,
	readOnly,
}: {
	busy: boolean;
	detail: AdminItemDetail;
	onCreateAttachment: () => void;
	onSelectAttachment: (key: string) => void;
	readOnly: boolean;
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
						<FileText
							aria-hidden
							className="shrink-0 text-black/40 dark:text-white/40"
							size={15}
							strokeWidth={1.7}
						/>
						<span className="min-w-0 flex-1 truncate text-sm font-medium text-black/75 dark:text-white/80">
							{attachment.title}
						</span>
						<span className="flex shrink-0 items-center gap-1">
							<RecordStateChip state={attachment.state} />
							<FileStateChip state={attachment.fileState} />
						</span>
						<ChevronRight
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
					className="bg-black/[0.035] font-medium hover:bg-black/[0.06] dark:bg-white/[0.045] dark:hover:bg-white/[0.08]"
					isDisabled={busy}
					onPress={onCreateAttachment}
					size="xs"
					startContent={<FilePlus2 aria-hidden size={14} />}
					variant="transparent"
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
	onPublishFile,
	onUnpublishFile,
	onUpload,
	readOnly,
}: {
	busy: boolean;
	detail: AdminItemDetail;
	fileError?: string;
	onDiscardFile: (key: string) => void;
	onPublishFile: (key: string, uploadRevision: number) => void;
	onUnpublishFile: (key: string) => void;
	onUpload: (key: string, file: File) => void;
	readOnly: boolean;
}) {
	const attachmentMetadataPublished =
		detail.state === "published" || detail.state === "edited";
	const parentMetadataPublished =
		detail.parentState === "published" || detail.parentState === "edited";
	const canPublishPdf =
		attachmentMetadataPublished && parentMetadataPublished;
	const publishPdfDisabledReason = canPublishPdf
		? null
		: !attachmentMetadataPublished && !parentMetadataPublished
			? "Publish the parent record and attachment metadata first"
			: !parentMetadataPublished
				? "Publish the parent record first"
				: "Publish the attachment metadata first";
	const formatFileSize = (bytes: number) =>
		bytes < 1024 * 102.4
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	const publishPdfButton =
		!readOnly && detail.fileDraft?.readyAt ? (
			<Button
				isDisabled={busy || Boolean(publishPdfDisabledReason)}
				onPress={() =>
					onPublishFile(detail.key, detail.fileDraft!.uploadRevision)
				}
				size="xs"
				startContent={<Send aria-hidden size={14} />}
				variant="transparent"
			>
				Publish PDF
			</Button>
		) : null;
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
								{detail.filePublication.pageCount} pages ·{" "}
								{formatFileSize(
									detail.filePublication.sizeBytes,
								)}
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
							startContent={<Download aria-hidden size={14} />}
							target="_blank"
							variant="transparent"
						>
							Open PDF
						</Button>
						{!readOnly ? (
							<Button
								isDisabled={busy}
								onPress={() => onUnpublishFile(detail.key)}
								size="xs"
								startContent={
									<RotateCcw aria-hidden size={14} />
								}
								variant="transparent"
							>
								Unpublish PDF
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
								{detail.fileDraft.pageCount
									? `${detail.fileDraft.pageCount} pages · `
									: ""}
								{formatFileSize(
									detail.fileDraft.expectedSizeBytes,
								)}
							</p>
						</div>
						<FileStateChip
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
					{!readOnly ? (
						<div className="mt-2 flex flex-wrap gap-1">
							{publishPdfButton && publishPdfDisabledReason ? (
								<Tooltip content={publishPdfDisabledReason}>
									<span className="inline-flex">
										{publishPdfButton}
									</span>
								</Tooltip>
							) : (
								publishPdfButton
							)}
							<Button
								isDisabled={busy}
								onPress={() => onDiscardFile(detail.key)}
								size="xs"
								startContent={<Trash2 aria-hidden size={14} />}
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
						<FileStateChip state="published" />
					</div>
					<Button
						as="a"
						className="mt-2"
						href={detail.sourceFileUrl}
						rel="noreferrer"
						size="xs"
						startContent={<Download aria-hidden size={14} />}
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
	onPublish,
	onPublishFile,
	onPublicationChanged,
	onReloadDraft,
	onRetry,
	onRestore,
	onSelectAttachment,
	onStartLinkPick,
	onStopLinkPick,
	onUnpublish,
	onUnpublishFile,
	onUpload,
	payload,
	saveMessage,
	saveState,
	sources,
	validationErrors = {},
	validationRevision = 0,
}: {
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
	onPublish: () => void;
	onPublishFile: (key: string, uploadRevision: number) => void;
	onPublicationChanged: () => void;
	onReloadDraft: () => void;
	onRetry: () => void;
	onRestore: () => void;
	onSelectAttachment: (key: string) => void;
	onStartLinkPick?: (kind: AdminItemLinkKind) => void;
	onStopLinkPick?: () => void;
	onUnpublish: () => void;
	onUnpublishFile: (key: string) => void;
	onUpload: (key: string, file: File) => void;
	payload: Record<string, unknown>;
	saveMessage: string | null;
	saveState: SaveState;
	sources: AdminSource[];
	validationErrors: AdminFieldErrors;
	validationRevision: number;
}) {
	const { identity } = useLibraryConfig();
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
				? computeAdminDraftDiff(detail, payload, definition)
				: EMPTY_ADMIN_DRAFT_DIFF,
		[definition, detail, payload],
	);
	const { entries: publishedCollectionEntries } = useResolvedAdminCollections(
		diff.collections ?? [],
	);
	const sourceWriteback = useAdminSourceWriteback(
		detail?.key ?? null,
		detail?.writeback?.sourceKey ?? null,
		detail?.revision ?? null,
	);
	const publication = useAdminPublication(
		detail && !detail.parentItem && detail.published ? detail.key : null,
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

	if (loading && !detail) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner label="Loading record" />
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
	const editable = detail.editable && Boolean(detail.draft) && !busy;
	const readOnly = !editable;
	const hasPublishedChild = detail.attachments.some(
		(attachment) =>
			attachment.state === "published" || attachment.state === "edited",
	);
	const itemUrl = buildAdminPublicItemUrl(detail, identity.baseUrl);
	const showPublicLinkActions =
		detail.itemType === "Attachment" || Boolean(itemUrl);

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-admin-region="inspector"
		>
			<div className="shrink-0 border-b border-black/[0.06] px-4 pb-4 pt-4 dark:border-white/[0.06]">
				{error ? (
					<div
						className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger"
						role="alert"
					>
						<span className="truncate">{error}</span>
						<Button
							onPress={onRetry}
							size="xs"
							variant="transparent"
						>
							Retry
						</Button>
					</div>
				) : loading ? (
					<div
						className="mb-3 flex items-center gap-2 text-xs text-black/45 dark:text-white/45"
						role="status"
					>
						<Spinner size="sm" />
						Refreshing…
					</div>
				) : null}
				{detail.parentItem ? (
					<Button
						className="mb-2"
						onPress={() => onBackToParent(detail.parentItem!)}
						size="xs"
						startContent={<ArrowLeft aria-hidden size={14} />}
						variant="transparent"
					>
						Parent record
					</Button>
				) : null}
				<div>
					<div className="flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<h2 className="text-lg font-semibold leading-snug tracking-[-0.01em] text-black/90 dark:text-white/95">
								{detail.title}
							</h2>
							<p className="mt-1 text-xs text-black/40 dark:text-white/40">
								{humanizeAdminField(detail.itemType)} ·{" "}
								{detail.key}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{showPublicLinkActions ? (
								<>
									<Tooltip content="Open public item">
										<Button
											as="a"
											aria-label="Open public item"
											href={itemUrl ?? undefined}
											isIconOnly
											isDisabled={!itemUrl}
											rel="noreferrer"
											size="xs"
											target="_blank"
											variant="transparent"
										>
											<ExternalLink aria-hidden size={14} />
										</Button>
									</Tooltip>
									<Tooltip content="Copy public item link">
										<Button
											aria-label="Copy public item link"
											isIconOnly
											isDisabled={!itemUrl}
											onPress={() => {
												if (!itemUrl) return;
												void navigator.clipboard
													.writeText(itemUrl)
													.then(() => toast.success("Item link copied"))
													.catch(() =>
														toast.error("Could not copy item link"),
													);
											}}
											size="xs"
											variant="transparent"
										>
											<Copy aria-hidden size={14} />
										</Button>
									</Tooltip>
								</>
							) : null}
							{!detail.editable ? (
								<Tooltip
									content={
										writebackUnavailableMessage[
											detail.writeback?.reason ?? "not-linked"
										]
									}
								>
									<Lock
										aria-label="Read only"
										className="text-black/35 dark:text-white/35"
										size={15}
									/>
								</Tooltip>
							) : null}
						</div>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						<RecordStateChip state={detail.state} />
						<FileStateChip state={detail.fileState} />
						{detail.writeback?.sourceKey ? (
							<AdminSourceWritebackStatus
								error={sourceWriteback.error}
								loading={sourceWriteback.loading}
								onRefresh={() => void sourceWriteback.refresh()}
								onRetry={() => void sourceWriteback.retry()}
								retrying={sourceWriteback.retrying}
								sourceLabel={
									detail.writeback.sourceLabel ??
									detail.writeback.sourceKey
								}
								status={sourceWriteback.status}
							/>
						) : null}
						{!detail.parentItem ? (
							<AdminPublicationHeaderStatus
								onPress={() =>
									document
										.getElementById("admin-doi-publishing")
										?.scrollIntoView({
											behavior: "smooth",
											block: "start",
										})
								}
								state={publication}
							/>
						) : null}
						<SaveIndicator
							message={saveMessage}
							onReload={onReloadDraft}
							state={saveState}
						/>
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-2">
						{!detail.editable ? (
							<Button
								className="h-9 rounded-xl px-3 font-semibold"
								color="accent"
								isDisabled={
									busy || detail.itemType === "Attachment"
								}
								onPress={onDuplicate}
								size="xs"
								startContent={<Copy aria-hidden size={14} />}
								variant="solid"
							>
								Duplicate as native
							</Button>
						) : detail.state === "deleted" && !detail.draft ? (
							<Button
								className="h-9 rounded-xl px-3 font-semibold"
								color="accent"
								isDisabled={busy}
								onPress={onRestore}
								size="xs"
								startContent={
									<RotateCcw aria-hidden size={14} />
								}
								variant="solid"
							>
								Restore
							</Button>
						) : !detail.draft ? (
							<Button
								className="h-9 rounded-xl px-3 font-semibold"
								color="accent"
								isDisabled={busy}
								onPress={onOpenDraft}
								size="xs"
								startContent={<Pencil aria-hidden size={14} />}
								variant="solid"
							>
								Edit
							</Button>
						) : null}
						{detail.draft ? (
							<>
								<Button
									color="accent"
									className="h-9 rounded-xl px-3 font-semibold"
									isDisabled={
										busy ||
										saveState === "conflict" ||
										saveState === "error"
									}
									onPress={onPublish}
									size="xs"
									startContent={
										<Send aria-hidden size={14} />
									}
									variant="solid"
								>
									{detail.state === "deleted"
										? "Restore and publish"
										: "Publish"}
								</Button>
								<Button
									className="h-9 rounded-xl px-3 font-medium text-danger hover:bg-danger/10"
									isDisabled={busy}
									onPress={onDiscardDraft}
									size="xs"
									startContent={
										<Trash2 aria-hidden size={14} />
									}
									variant="transparent"
								>
									{detail.published
										? "Discard changes"
										: "Delete draft"}
								</Button>
							</>
						) : null}
						{native && detail.state === "published" ? (
							<Tooltip
								content={
									hasPublishedChild
										? "Unpublish child attachments first"
										: "Remove this record from the public library"
								}
							>
								<span>
									<Button
										className="h-9 rounded-xl px-3 font-medium text-danger hover:bg-danger/10"
										isDisabled={busy || hasPublishedChild}
										onPress={onUnpublish}
										size="xs"
										startContent={
											<RotateCcw aria-hidden size={14} />
										}
										variant="transparent"
									>
										Unpublish
									</Button>
								</span>
							</Tooltip>
						) : null}
					</div>
					<ValidationSummary
						errors={validationErrors}
						recordKey={detail.key}
					/>
				</div>
			</div>

			<div
				className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4"
				data-admin-region="inspector-scroll"
			>
				{!detail.parentItem ? (
					<Section
						icon={BadgeCheck}
						id="admin-doi-publishing"
						title="DOI publishing"
					>
						<AdminPublicationStatus
							itemKey={detail.key}
							onOpenAttachments={() =>
								document
									.getElementById("admin-attachments")
									?.scrollIntoView({
										behavior: "smooth",
										block: "start",
									})
							}
							onRecordChanged={onPublicationChanged}
							published={Boolean(detail.published)}
							state={publication}
						/>
					</Section>
				) : null}
				<Section icon={FilePenLine} id="admin-metadata" title="Metadata">
					<MetadataEditor
						key={`${detail.key}:${String(payload.itemType ?? detail.itemType)}`}
						definitions={definitions}
						detail={detail}
						diff={diff}
						errors={validationErrors}
						onChange={onChange}
						payload={payload}
						readOnly={readOnly}
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
						icon={Users}
						title="Creators"
					>
						<CreatorsEditor
							definition={definition}
							errors={validationErrors}
							onChange={onChange}
							payload={payload}
							readOnly={readOnly}
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
					icon={Tag}
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
									onChange({ ...payload, links: diff.links })
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
					icon={Link2}
					title="Links"
				>
					<AdminLinksEditor
						detail={detail}
						errors={validationErrors}
						knownTargets={linkTargets}
						onChange={onChange}
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
						icon={Folder}
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
						detail.itemType === "Attachment" ? FileText : Paperclip
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
							onPublishFile={onPublishFile}
							onUnpublishFile={onUnpublishFile}
							onUpload={onUpload}
							readOnly={!native}
						/>
					) : (
						<AttachmentList
							busy={busy}
							detail={detail}
							onCreateAttachment={onCreateAttachment}
							onSelectAttachment={onSelectAttachment}
							readOnly={!native}
						/>
					)}
				</Section>
				<Section icon={History} title="Revision">
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
