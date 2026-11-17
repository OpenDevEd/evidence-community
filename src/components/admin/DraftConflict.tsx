"use client";

import { licenceLabel, type RecordLicence } from "@/lib/licences";
import { describeCountryFocus } from "@/lib/country-focus";
import { describeOpenAccessChoice } from "@/lib/open-access";
import { describeStudyTypeChoice } from "@/lib/readings/study-types";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { adminCanonicalPayloadToItemFields } from "@/lib/admin/item-fields";

import { adminFieldLabel } from "@/lib/admin/errors";
import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";
import { useState } from "react";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { useResolvedAdminCollections } from "./useResolvedAdminCollections";
import {
	PencilIcon,
	Tick01Icon,
	AlertCircleIcon,
	UserEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";

const sourceLabels = {
	draft: { icon: PencilIcon, label: "Your draft" },
	published: { icon: Tick01Icon, label: "Editor's published version" },
};

function formFieldName(field: string, payload: Record<string, unknown>) {
	return (
		Object.keys(
			adminCanonicalPayloadToItemFields(
				{ [field]: null },
				String(payload.itemType),
			),
		)[0] ?? field
	);
}

export function ConflictValue({
	field,
	value,
}: {
	field: string;
	value: unknown;
}) {
	if (field === "countryFocus") return describeCountryFocus(value);
	if (field === "openAccess") return describeOpenAccessChoice(value);
	if (field === "studyType") return describeStudyTypeChoice(value);
	if (field === "licence") return value ? licenceLabel(value as RecordLicence) : <span className="text-black/45 dark:text-white/45">None</span>;
	if (
		value == null ||
		value === "" ||
		(Array.isArray(value) && value.length === 0)
	) {
		return <span className="text-black/45 dark:text-white/45">Empty</span>;
	}
	if (field === "collections" && Array.isArray(value))
		return <CollectionConflictValue keys={value.map(String)} />;
	if (Array.isArray(value)) {
		return (
			<span className="flex flex-col gap-1">
				{value.map((entry, index) => (
					<span key={index}>
						<ConflictValue field={field} value={entry} />
					</span>
				))}
			</span>
		);
	}
	if (typeof value === "object")
		return <ObjectConflictValue field={field} value={value} />;
	return String(value);
}

function CollectionConflictLine({
	entry,
	collectionKey,
	pending,
}: {
	entry: AdminCollectionCatalogEntry | undefined;
	collectionKey: string;
	pending: boolean;
}) {
	// A name read after this line first rendered fades into the line kept for it; a name the admin already held is there at once.
	const [readLate] = useState(pending);
	if (pending) return <span aria-hidden className="block">&nbsp;</span>;
	// The inspector leaves out a collection that no longer exists; a choice still needs to show what it would keep, so it shows the key.
	if (!entry)
		return (
			<span className="block truncate text-black/45 dark:text-white/45">
				{collectionKey}
			</span>
		);
	return (
		<span
			className={`flex min-w-0 gap-2 ${readLate ? "motion-safe:animate-fade-in motion-safe:[animation-duration:200ms]" : ""}`}
		>
			<TruncatedText text={entry.name} />
			{entry.deleted && <span className="shrink-0 text-warning">Deleted</span>}
		</span>
	);
}

/** One line per collection, so names that arrive late fill their lines without moving the choices below. */
function CollectionConflictValue({ keys }: { keys: string[] }) {
	const { entries, loading } = useResolvedAdminCollections(keys);
	const byKey = new Map(entries.map((entry) => [entry.key, entry]));
	return (
		<span className="flex flex-col gap-1">
			{keys.map((key) => (
				<CollectionConflictLine
					key={key}
					collectionKey={key}
					entry={byKey.get(key)}
					pending={loading && !byKey.has(key)}
				/>
			))}
		</span>
	);
}

function textField(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

function institutionName(entry: unknown) {
	if (typeof entry === "string") return [entry];
	if (!entry || typeof entry !== "object") return [];
	const displayName = (entry as Record<string, unknown>).display_name;
	return typeof displayName === "string" ? [displayName] : [];
}

function creatorAffiliations(creator: Record<string, unknown>) {
	return [
		...(Array.isArray(creator.institutions)
			? creator.institutions.flatMap(institutionName)
			: []),
		...(typeof creator.affiliation === "string" ? [creator.affiliation] : []),
	].filter((entry, index, entries) => entry && entries.indexOf(entry) === index);
}

function CreatorConflictValue({ creator }: { creator: Record<string, unknown> }) {
	const name = creatorDisplayName({
		name: textField(creator.name),
		firstName: textField(creator.firstName),
		lastName: textField(creator.lastName),
	});
	const affiliations = creatorAffiliations(creator);
	return (
		<span className="flex flex-col gap-0.5">
			<span>
				{name || "Unnamed creator"}
				{typeof creator.creatorType === "string" && (
					<span className="ml-2 text-black/45 dark:text-white/45">
						{adminFieldLabel(creator.creatorType)}
					</span>
				)}
			</span>
			{affiliations.length > 0 && (
				<span className="text-black/45 dark:text-white/45">
					{affiliations.join("; ")}
				</span>
			)}
		</span>
	);
}

function ObjectConflictValue({
	field,
	value,
}: {
	field: string;
	value: object;
}) {
	if (field === "creators")
		return (
			<CreatorConflictValue creator={value as Record<string, unknown>} />
		);
	if (field === "tags" && "tag" in value)
		return <ConflictValue field="tag" value={value.tag} />;
	return (
		<span className="flex flex-col gap-1">
			{Object.entries(value).map(([key, entry]) => (
				<span key={key}>
					<span className="mr-2 font-medium">{adminFieldLabel(key)}</span>
					<ConflictValue field={key} value={entry} />
				</span>
			))}
		</span>
	);
}

export function DraftConflict({
	payload,
	published,
	conflictFields,
	disabled,
	onResolve,
	source = "published",
}: {
	payload: Record<string, unknown>;
	published: Record<string, unknown>;
	conflictFields: string[];
	disabled: boolean;
	source?: "published" | "session";
	onResolve: (choices: Record<string, "draft" | "published">) => void;
}) {
	const [choices, setChoices] = useState<Record<string, "draft" | "published">>(
		{},
	);
	const currentValues = adminCanonicalPayloadToItemFields(payload, String(payload.itemType));
	const otherValues = adminCanonicalPayloadToItemFields(published, String(published.itemType));
	const fields = conflictFields.map((key) => ({
		key,
		label: adminFieldLabel(formFieldName(key, payload)),
	}));
	const count = fields.filter(({ key }) => choices[key]).length;
	const labels =
		source === "session"
			? {
					draft: { ...sourceLabels.draft, label: "Your changes" },
					published: {
						icon: UserEdit01Icon,
						label: "Saved in another session",
					},
				}
			: sourceLabels;
	return (
		<section
			aria-label="Resolve draft conflicts"
			className="overflow-hidden rounded-xl border border-amber-500/20"
		>
			<div className="flex items-start gap-2.5 bg-amber-500/[0.06] p-3">
				<HugeiconsIcon
					icon={AlertCircleIcon}
					size={17}
					className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
				/>
				<div>
					<h3 className="text-xs font-semibold">
						{fields.length === 1
							? "One edit needs your choice"
							: `${fields.length} edits need your choice`}
					</h3>
					<p className="mt-1 text-[11px] leading-relaxed text-black/55 dark:text-white/55">
						{source === "session"
							? "Another session saved changes to these fields. Choose which values to keep in your draft."
							: "An Editor published corrections while you edited this draft. Choose which values to keep before submitting again. The published item stays unchanged."}
					</p>
				</div>
			</div>
			<div className="divide-y divide-black/[0.06] dark:divide-white/[0.07]">
				{fields.map(({ key, label }) => (
					<fieldset key={key} className="min-w-0 p-3">
						<legend className="float-left mb-2 w-full text-xs font-medium">
							{label}
						</legend>
						<div className="clear-both grid gap-2">
							{(["draft", "published"] as const).map((source) => (
								<label
									key={source}
									className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${choices[key] === source ? "border-accent/40 bg-accent/[0.06]" : "border-black/[0.08] hover:bg-black/[0.025] dark:border-white/[0.09] dark:hover:bg-white/[0.025]"}`}
								>
									<input
										type="radio"
										name={`conflict-${key}`}
										checked={choices[key] === source}
										onChange={() =>
											setChoices({
												...choices,
												[key]: source,
											})
										}
										className="mt-0.5 size-3.5 shrink-0 accent-accent"
									/>
									<span className="min-w-0">
										<span className="flex items-center gap-1.5 text-[10px] font-medium text-black/50 dark:text-white/50">
											<HugeiconsIcon icon={labels[source].icon} size={12} />
											{labels[source].label}
										</span>
										<span className="mt-1.5 block break-words text-xs leading-relaxed">
											<ConflictValue
												field={key}
												value={
													source === "draft"
														? currentValues[formFieldName(key, payload)]
														: otherValues[formFieldName(key, published)]
												}
											/>
										</span>
									</span>
								</label>
							))}
						</div>
					</fieldset>
				))}
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-black/[0.06] p-3 dark:border-white/[0.07]">
				<span className="text-[11px] text-black/45 dark:text-white/45">
					{count} of {fields.length} chosen
				</span>
				<Button
					size="sm"
					isDisabled={disabled || count !== fields.length}
					isLoading={disabled}
					startContent={<HugeiconsIcon icon={Tick01Icon} size={14} />}
					onPress={() => onResolve(choices)}
				>
					Apply to draft
				</Button>
			</div>
		</section>
	);
}
