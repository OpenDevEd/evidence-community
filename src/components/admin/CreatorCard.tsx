"use client";

import { useId, type ReactNode } from "react";
import {
	Add01Icon,
	Tick01Icon,
	ArrowDown01Icon,
	ArrowUp01Icon,
	ArrowUpRight01Icon,
	ArrowLeftRightIcon,
	Building03Icon,
	Delete02Icon,
	PencilIcon,
	Search01Icon,
	UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import OpenScholar from "@/components/icons/OpenScholar";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Tooltip } from "@/components/nextui/Tooltip";
import { Spinner } from "@/components/nextui/Spinner";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import {
	formatInstitutionNames,
	hasInstitution,
	parseInstitutionNames,
} from "@/config/library-config/institutions";
import type { AdminCreator } from "@/lib/admin/types";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { InspectorChoices } from "./InspectorChoices";
import { InstitutionInput } from "./InstitutionInput";
import { humanizeAdminField } from "./admin-schema";

export type CreatorMode = "profile" | "manual";

/** The author's own affiliations, and how a profile's affiliation joins them. */
type AffiliationProps = {
	institutions: readonly string[];
	onAddInstitution?: (name: string) => void;
};

export function AuthorAffiliation({
	affiliation,
	className = "",
	action,
}: {
	affiliation: string;
	className?: string;
	action?: ReactNode;
}) {
	if (!affiliation) return null;
	return (
		<div
			className={`flex min-w-0 items-start gap-2 text-xs leading-relaxed text-black/60 dark:text-white/60 ${className}`}
		>
			<HugeiconsIcon
				icon={Building03Icon}
				size={15}
				className="mt-0.5 shrink-0 text-black/40 dark:text-white/40"
				aria-hidden
			/>
			<span className="min-w-0 flex-1 self-center">{affiliation}</span>
			{action}
		</div>
	);
}

type CreatorCardProps = {
	readOnly?: boolean;
	errors?: AdminFieldErrors;
	profileLoading?: boolean;
	onRetryProfile?: () => void;
	creator: AdminCreator;
	profile?: AuthorProfile;
	mode: CreatorMode;
	roles: readonly { creatorType: string }[];
	index: number;
	count: number;
	onModeChange: (mode: CreatorMode) => void;
	onChange: (creator: AdminCreator) => void;
	onPick: () => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
};

/** The same editor frame supports manually entered and linked creators. */
export function CreatorCard({
	creator,
	profile,
	mode,
	roles,
	index,
	count,
	onModeChange,
	onChange,
	onPick,
	onMove,
	onRemove,
	readOnly = false,
	errors = {},
	profileLoading = false,
	onRetryProfile,
}: CreatorCardProps) {
	const rowError = errors[`creators.${index}`];
	const affiliations = (creator.institutions ?? []).flatMap((entry) =>
		entry.display_name ? [entry.display_name] : [],
	);
	const setAffiliations = (names: readonly string[]) => {
		const { institutions: _previous, ...rest } = creator;
		onChange(
			names.length > 0
				? {
						...rest,
						institutions: names.map((display_name) => ({
							display_name,
						})),
					}
				: rest,
		);
	};
	const fieldError = (field: string) => errors[`creators.${index}.${field}`];
	return (
		<section
			aria-label={`Creator ${index + 1}`}
			id={`admin-creator-${index}`}
			role="group"
			tabIndex={-1}
			aria-describedby={
				rowError ? `admin-creator-${index}-error` : undefined
			}
			className="overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.025]"
		>
			<InspectorChoices
				disabled={readOnly}
				label="Creator source"
				value={mode}
				onChange={onModeChange}
				options={[
					{
						key: "profile",
						label: "Openscholar",
						content: (
							<>
								<OpenScholar
									aria-hidden
									className="size-4 shrink-0"
								/>
								Openscholar
							</>
						),
					},
					{
						key: "manual",
						label: "Manual entry",
						content: (
							<>
								<HugeiconsIcon
									icon={PencilIcon}
									size={14}
									aria-hidden
								/>
								Manual entry
							</>
						),
					},
				]}
			/>
			<div className="px-3.5 pb-3.5 pt-3">
				<CreatorIdentity
					creator={creator}
					profile={profile}
					mode={mode}
					readOnly={readOnly}
					institutions={affiliations}
					onAddInstitution={(name) =>
						setAffiliations(
							parseInstitutionNames(
								formatInstitutionNames([...affiliations, name]),
							),
						)
					}
					onPick={onPick}
					profileLoading={profileLoading}
					onRetryProfile={onRetryProfile}
					errors={errors}
					index={index}
					onChange={onChange}
				/>
				<div className="mt-2.5 space-y-1.5">
					<label
						htmlFor={`admin-creator-${index}-affiliations`}
						className="block text-xs font-medium text-black/50 dark:text-white/50"
					>
						Affiliations
					</label>
					<InstitutionInput
						id={`admin-creator-${index}-affiliations`}
						label={`Affiliations of creator ${index + 1}`}
						value={formatInstitutionNames(affiliations)}
						onValueChange={(value) =>
							setAffiliations(parseInstitutionNames(value))
						}
						disabled={readOnly}
						error={fieldError("institutions")}
					/>
				</div>
			</div>
			<div className="flex items-center gap-2 border-t border-black/[0.055] px-2.5 py-2 dark:border-white/[0.06]">
				<Select
					isDisabled={readOnly}
					id={`admin-creator-${index}-role`}
					isInvalid={Boolean(fieldError("creatorType"))}
					errorMessage={fieldError("creatorType")}
					color="filled"
					aria-label={`Creator ${index + 1} role`}
					selectedKeys={new Set([creator.creatorType])}
					onSelectionChange={(keys) => {
						const creatorType = [...keys][0];
						if (typeof creatorType === "string")
							onChange({ ...creator, creatorType });
					}}
					size="sm"
					className="min-w-0 flex-1"
					classNames={{
						trigger:
							"h-8 min-h-8 rounded-lg bg-transparent shadow-none",
						value: "text-xs font-medium",
					}}
				>
					{roles.map((role) => (
						<SelectItem key={role.creatorType}>
							{humanizeAdminField(role.creatorType)}
						</SelectItem>
					))}
				</Select>
				<div
					className="flex shrink-0 items-center"
					role="group"
					aria-label="Creator actions"
				>
					{[
						{
							label: "Move creator up",
							icon: ArrowUp01Icon,
							disabled: index === 0,
							action: () => onMove(-1),
						},
						{
							label: "Move creator down",
							icon: ArrowDown01Icon,
							disabled: index === count - 1,
							action: () => onMove(1),
						},
						{
							label: "Remove creator",
							icon: Delete02Icon,
							disabled: false,
							action: onRemove,
						},
					].map((action) => (
						<Tooltip key={action.label} content={action.label}>
							<Button
								isIconOnly
								aria-label={action.label}
								size="xs"
								variant="transparent"
								isDisabled={readOnly || action.disabled}
								onPress={action.action}
								className="size-8 rounded-lg text-black/45 dark:text-white/45"
							>
								<HugeiconsIcon icon={action.icon} size={14} />
							</Button>
						</Tooltip>
					))}
				</div>
			</div>
			{rowError && (
				<p
					id={`admin-creator-${index}-error`}
					className="px-3.5 pb-3 text-xs text-danger"
				>
					{rowError}
				</p>
			)}
		</section>
	);
}

function LinkedCreatorProfile({
	profile,
	readOnly,
	institutions,
	onAddInstitution,
	onPick,
}: Pick<CreatorCardProps, "readOnly" | "onPick"> &
	AffiliationProps & { profile: AuthorProfile }) {
	const institutionAdded = hasInstitution(institutions, profile.affiliation);
	return (
		<>
			<div className="flex items-center gap-3">
				<AuthorAvatar
					src={profile.photo ?? undefined}
					name={profile.name}
					className="w-14 h-14 shrink-0 self-start rounded-xl bg-black/[0.045] text-black/35 dark:bg-white/[0.06] dark:text-white/45"
				/>
				<div className="min-w-0 flex-1">
					<p className="text-[15px] font-semibold leading-snug text-black/85 dark:text-white/90">
						{profile.name}
					</p>
					{profile.headline && (
						<p className="mt-1 text-xs leading-relaxed text-black/50 dark:text-white/50">
							{profile.headline}
						</p>
					)}
				</div>
			</div>
			<AuthorAffiliation
				affiliation={profile.affiliation}
				className="mt-3 rounded-lg bg-black/[0.025] px-2.5 py-2 dark:bg-white/[0.03]"
				action={
					onAddInstitution && (
						<Tooltip
							content={
								institutionAdded
									? "Added to this author's affiliations"
									: "Add to this author's affiliations"
							}
						>
							<Button
								isIconOnly
								size="xs"
								variant="transparent"
								aria-label={
									institutionAdded
										? `${profile.affiliation} added to affiliations`
										: `Add ${profile.affiliation} as an affiliation`
								}
								isDisabled={readOnly || institutionAdded}
								onPress={() =>
									onAddInstitution(profile.affiliation)
								}
								className={`!h-6 !w-6 shrink-0 rounded-md ${institutionAdded ? "text-emerald-600 dark:text-emerald-400 disabled:opacity-100" : "bg-white text-black/55 dark:bg-white/[0.05] dark:text-white/65"}`}
							>
								<HugeiconsIcon
									icon={
										institutionAdded
											? Tick01Icon
											: Add01Icon
									}
									size={14}
								/>
							</Button>
						</Tooltip>
					)
				}
			/>
			<div className="mt-2.5 flex items-center justify-between gap-2">
				<Button
					size="xs"
					variant="transparent"
					as="a"
					role="link"
					href={profile.url}
					target="_blank"
					rel="noopener noreferrer"
					className="h-8 min-w-0 gap-1.5 px-1 text-xs text-black/55 dark:text-white/55"
					endContent={
						<HugeiconsIcon icon={ArrowUpRight01Icon} size={13} />
					}
				>
					View profile
				</Button>
				<Button
					size="xs"
					variant="transparent"
					isDisabled={readOnly}
					onPress={onPick}
					className="h-8 min-w-0 gap-1.5 px-2 text-xs"
					startContent={
						<HugeiconsIcon icon={ArrowLeftRightIcon} size={13} />
					}
				>
					Change author
				</Button>
			</div>
		</>
	);
}

function ManualCreatorFields({
	creator,
	readOnly,
	errors = {},
	index,
	onChange,
}: Pick<
	CreatorCardProps,
	"creator" | "readOnly" | "errors" | "index" | "onChange"
>) {
	const fieldId = useId();
	const organization = creator.organization === true;
	const fieldError = (field: string) => errors[`creators.${index}.${field}`];
	// A person whose whole name came in one field, as OpenAlex and Openscholar give it, keeps it in one.
	const personFields =
		typeof creator.name === "string"
			? ([["name", "Name", "e.g. Maya Chen"]] as const)
			: ([
					["firstName", "First name", "e.g. Maya"],
					["lastName", "Last name", "e.g. Chen"],
				] as const);
	return (
		<div className="space-y-3">
			<InspectorChoices
				disabled={readOnly}
				variant="inset"
				label="Name type"
				value={organization ? "organization" : "person"}
				onChange={(value) => {
					const nextOrganization = value === "organization";
					if (nextOrganization === organization) return;
					const next = { ...creator };
					if (nextOrganization) {
						next.name =
							creator.name ??
							[creator.firstName, creator.lastName]
								.filter(Boolean)
								.join(" ");
						delete next.firstName;
						delete next.lastName;
						next.organization = true;
					} else {
						delete next.organization;
						delete next.name;
						// As Zotero splits a one-field name when it gets two: the last word is the last name, the rest the first.
						const words = (creator.name ?? "").trim().split(/\s+/);
						next.lastName = words.pop() ?? "";
						next.firstName = words.join(" ");
					}

					onChange(next);
				}}
				options={[
					{
						key: "person",
						label: "Person",
						content: (
							<>
								<HugeiconsIcon icon={UserIcon} size={13} />
								Person
							</>
						),
					},
					{
						key: "organization",
						label: "Organisation",
						content: (
							<>
								<HugeiconsIcon
									icon={Building03Icon}
									size={13}
								/>
								Organisation
							</>
						),
					},
				]}
			/>
			{organization ? (
				<Input
					isDisabled={readOnly}
					color="filled"
					aria-label="Organisation name"
					id={`admin-creator-${index}-organisation`}
					isInvalid={Boolean(fieldError("name"))}
					errorMessage={fieldError("name")}
					placeholder="Organisation name"
					value={creator.name ?? ""}
					onValueChange={(name) => onChange({ ...creator, name })}
					classNames={{
						inputWrapper: "h-10 min-h-10 rounded-xl",
						input: "text-sm",
					}}
				/>
			) : (
				<div
					className={`grid gap-2.5 ${personFields.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
				>
					{personFields.map(([field, label, placeholder]) => (
						<div key={field} className="space-y-1.5">
							<label
								htmlFor={`${fieldId}-${field}`}
								className="block text-xs font-medium text-black/50 dark:text-white/50"
							>
								{label}
							</label>
							<Input
								isDisabled={readOnly}
								color="filled"
								id={`${fieldId}-${field}`}
								isInvalid={Boolean(fieldError(field))}
								errorMessage={fieldError(field)}
								aria-label={label}
								placeholder={placeholder}
								value={creator[field] ?? ""}
								onValueChange={(value) =>
									onChange({
										...creator,
										[field]: value,
									})
								}
								classNames={{
									inputWrapper: "h-10 min-h-10 rounded-xl",
									input: "text-sm",
								}}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function UnselectedCreator({
	creator,
	profileLoading,
	onRetryProfile,
	onPick,
	readOnly,
}: Pick<
	CreatorCardProps,
	"creator" | "profileLoading" | "onRetryProfile" | "onPick" | "readOnly"
>) {
	return creator.authorProfileId ? (
		<div
			className="flex min-h-24 items-center justify-center gap-3"
			aria-live="polite"
		>
			{profileLoading ? (
				<Spinner size="sm" aria-label="Loading author profile" />
			) : (
				<div className="space-y-2 text-center">
					<p className="text-xs text-black/50 dark:text-white/50">
						Author profile unavailable.
					</p>
					<Button
						size="xs"
						variant="transparent"
						onPress={onRetryProfile}
					>
						Try again
					</Button>
				</div>
			)}
		</div>
	) : (
		<button
			disabled={readOnly}
			type="button"
			onClick={onPick}
			className="flex w-full items-center gap-3 rounded-xl border border-black/[0.08] bg-white p-3 text-left transition-colors hover:border-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:border-white/[0.08] dark:bg-white/[0.025] dark:hover:border-accent/30"
		>
			<span className="grid size-11 shrink-0 place-items-center self-start rounded-xl bg-black/[0.035] dark:bg-white/[0.05]">
				<HugeiconsIcon
					icon={Search01Icon}
					size={20}
					className="text-black/40 dark:text-white/45"
				/>
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium">
					Choose an author
				</span>
				<span className="mt-1 block text-xs leading-relaxed text-black/45 dark:text-white/45">
					Find a profile on Openscholar
				</span>
			</span>
		</button>
	);
}

function CreatorIdentity({
	creator,
	profile,
	mode,
	readOnly,
	institutions,
	onAddInstitution,
	onPick,
	profileLoading,
	onRetryProfile,
	errors,
	index,
	onChange,
}: Pick<
	CreatorCardProps,
	| "creator"
	| "profile"
	| "mode"
	| "readOnly"
	| "onPick"
	| "profileLoading"
	| "onRetryProfile"
	| "errors"
	| "index"
	| "onChange"
> &
	AffiliationProps) {
	return mode === "profile" ? (
		profile ? (
			<LinkedCreatorProfile
				profile={profile}
				readOnly={readOnly}
				institutions={institutions}
				onAddInstitution={onAddInstitution}
				onPick={onPick}
			/>
		) : (
			<UnselectedCreator
				creator={creator}
				profileLoading={profileLoading}
				onRetryProfile={onRetryProfile}
				onPick={onPick}
				readOnly={readOnly}
			/>
		)
	) : (
		<ManualCreatorFields
			creator={creator}
			readOnly={readOnly}
			errors={errors}
			index={index}
			onChange={onChange}
		/>
	);
}
