"use client";

import { adminPanelTabState } from "./admin-tab-styles";
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AdminStatusAccordion } from "./AdminStatusAccordion";
import {
	Clock01Icon,
	FileViewIcon,
	CheckmarkBadge01Icon,
	Mail01Icon,
	Undo02Icon,
	ViewIcon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Switch } from "@/components/nextui/Switch";
import { Tooltip } from "@/components/nextui/Tooltip";
import { PublicationStatusBadges } from "@/components/features/items/PublicationHoverPreview";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { hasAnyTag } from "@/lib/tags";
import { ITEM_DISPLAY_OPTIONS, setItemDisplayTag } from "@/lib/item-display";
import type { AdminItemDetail } from "@/lib/admin/types";

const displayIcons = {
	hidden: ViewOffSlashIcon,
	internal: Mail01Icon,
	comingSoon: Clock01Icon,
};
const controlLabels = { internal: "On request", comingSoon: "Coming soon" };

type ItemDisplayProps = {
	title: string;
	publishedDetail: AdminItemDetail;
	publicationStatus: ReactNode;
	tags: string[];
	readOnly: boolean;
	onChange: (tags: string[]) => void;
};

export function AdminItemDisplay({
	title,
	publishedDetail,
	publicationStatus,
	tags,
	readOnly,
	onChange,
}: ItemDisplayProps) {
	const { content } = useLibraryConfig();
	const [version, setVersion] = useState<"draft" | "published">("draft");
	const hidden = hasAnyTag(tags, content.tags.hidden);

	const labelFor = (key: (typeof ITEM_DISPLAY_OPTIONS)[number]["key"]) =>
		key === "hidden" ? (hidden ? "Hidden" : "Visible") : controlLabels[key];
	const iconFor = (key: (typeof ITEM_DISPLAY_OPTIONS)[number]["key"]) =>
		key === "hidden" && !hidden ? ViewIcon : displayIcons[key];
	return (
		<section id="admin-library-display" aria-label="Library display">
			<AdminStatusAccordion
				title="Library display"
				summary={
					<span className="flex flex-wrap gap-x-3 gap-y-1">
						{ITEM_DISPLAY_OPTIONS.filter(
							({ key }) =>
								key === "hidden" ||
								hasAnyTag(tags, content.tags[key]),
						).map(({ key }) => (
							<span
								key={key}
								className="inline-flex items-center gap-1"
							>
								<HugeiconsIcon icon={iconFor(key)} size={12} />
								{labelFor(key)}
							</span>
						))}
					</span>
				}
			>
				<DisplayToggles
					tags={tags}
					readOnly={readOnly}
					onChange={(next) => {
						onChange(next);
						setVersion("draft");
					}}
				/>
				<ItemDisplayPreview
					title={title}
					publishedDetail={publishedDetail}
					publicationStatus={publicationStatus}
					tags={tags}
					readOnly={readOnly}
					onChange={onChange}
					version={version}
					setVersion={setVersion}
				/>
			</AdminStatusAccordion>
		</section>
	);
}

type DisplayKey = (typeof ITEM_DISPLAY_OPTIONS)[number]["key"];

function DisplayToggles({
	tags,
	readOnly,
	onChange,
	keys = ITEM_DISPLAY_OPTIONS.map(({ key }) => key),
}: {
	tags: readonly string[];
	readOnly: boolean;
	onChange: (tags: string[]) => void;
	keys?: readonly DisplayKey[];
}) {
	const { content } = useLibraryConfig();
	return (
		<div role="group" aria-label="Appearance controls" className="mb-3 space-y-1">
			{ITEM_DISPLAY_OPTIONS.filter(({ key }) => keys.includes(key)).map(({ key, label, description }) => (
				<Tooltip
					isDisabled={key === "comingSoon"}
					key={key}
					content={description}
					placement="left"
					classNames={{ content: "max-w-64 whitespace-normal text-xs leading-5" }}
				>
					<Switch
						color="accent"
						isSelected={hasAnyTag(tags, content.tags[key])}
						isDisabled={readOnly || !content.tags[key].length}
						onValueChange={(enabled) => onChange(setItemDisplayTag(tags, content.tags[key], enabled))}
						classNames={{
							base: "flex h-10 w-full max-w-none justify-between rounded-lg px-1 py-2",
							label: "ms-0 flex items-center gap-2 text-xs font-medium text-black/75 dark:text-white/75",
							wrapper: "shrink-0",
						}}
					>
						<HugeiconsIcon icon={displayIcons[key]} size={15} />
						{label}
					</Switch>
				</Tooltip>
			))}
		</div>
	);
}

/** Attachments only hide or show; the record's other display states do not apply to a file. */
/**
 * An attachment's place in the public record. A note or an ordinary link is public only with one of its record's
 * publish tags, so it says which tags those are.
 */
export function AttachmentDisplay({ tags, readOnly, onChange, publishTags }: {
	tags: readonly string[];
	readOnly: boolean;
	onChange: (tags: string[]) => void;
	/** The tags that make this note or link public; omitted for attachments shown without one. */
	publishTags?: readonly string[];
}) {
	const { content } = useLibraryConfig();
	const hidden = hasAnyTag(tags, content.tags.hidden);
	const unpublished = Boolean(publishTags) && !hasAnyTag(tags, publishTags ?? []);
	return (
		<section aria-label="Library display">
			<AdminStatusAccordion
				title="Library display"
				summary={
					<span className="inline-flex items-center gap-1">
						<HugeiconsIcon icon={hidden || unpublished ? displayIcons.hidden : ViewIcon} size={12} />
						{hidden ? "Hidden" : unpublished ? "Private" : "Visible"}
					</span>
				}
			>
				<DisplayToggles tags={tags} readOnly={readOnly} onChange={onChange} keys={["hidden"]} />
				{publishTags ? (
					<p className="mb-3 flex flex-wrap items-center gap-1 px-1 text-xs text-black/55 dark:text-white/55">
						{publishTags.length ? "Public with one of these tags" : "Its source has no publish tags, so it stays private"}
						{publishTags.map((tag) => (
							<span key={tag} className="rounded bg-black/[0.05] px-1 font-mono text-[10px] text-black/60 dark:bg-white/[0.07] dark:text-white/60">{tag}</span>
						))}
					</p>
				) : null}
			</AdminStatusAccordion>
		</section>
	);
}

function publishedPreviewTitle(detail: AdminItemDetail) {
	return String(detail.published?.title || detail.title);
}

function ItemDisplayPreview({
	title,
	publishedDetail,
	publicationStatus,
	tags,
	readOnly,
	onChange,
	version,
	setVersion,
}: ItemDisplayProps & {
	version: "draft" | "published";
	setVersion: (version: "draft" | "published") => void;
}) {
	const { content } = useLibraryConfig();
	const published =
		publishedDetail.state !== "deleted" ? publishedDetail.published : null;
	const selectedVersion = published ? version : "draft";
	const previewTags =
		selectedVersion === "published" ? publishedDetail.publishedTags : tags;

	const previewTitle =
		selectedVersion === "published"
			? publishedPreviewTitle(publishedDetail)
			: title;
	const changed =
		Boolean(published) &&
		ITEM_DISPLAY_OPTIONS.some(
			({ key }) =>
				hasAnyTag(tags, content.tags[key]) !==
				hasAnyTag(publishedDetail.publishedTags, content.tags[key]),
		);
	return (
		<div className="overflow-hidden rounded-xl bg-card_light dark:bg-card border border-black/[0.08] dark:border-white/10">
			<ItemPreviewTabs
				revision={published ? publishedDetail.revision : null}
				version={selectedVersion}
				onSelect={setVersion}
			/>
			<ReaderPreview tags={previewTags} title={previewTitle} />
			<div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-3 py-1 dark:border-white/[0.06]">
				{publicationStatus}
				<Tooltip content="Revert display changes">
					<Button
						aria-label="Revert display changes"
						isIconOnly
						size="xs"
						variant="transparent"
						isDisabled={!changed || readOnly}
						className="h-8 w-8 rounded-lg text-black/45 dark:text-white/45"
						onPress={() => {
							onChange(
								ITEM_DISPLAY_OPTIONS.reduce(
									(result, { key }) =>
										setItemDisplayTag(
											result,
											content.tags[key],
											hasAnyTag(
												publishedDetail.publishedTags,
												content.tags[key],
											),
										),
									tags,
								),
							);
							setVersion("draft");
						}}
					>
						<HugeiconsIcon icon={Undo02Icon} size={14} />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}

function ItemPreviewTabs({
	revision,
	version,
	onSelect,
}: {
	revision: number | null;
	version: "draft" | "published";
	onSelect: (version: "draft" | "published") => void;
}) {
	return (
		<div role="group" aria-label="Preview version" className="flex">
			{(["draft", "published"] as const).map((value) => (
				<Button
					key={value}
					size="xs"
					variant="transparent"
					aria-label={
						value === "draft"
							? "Preview after publishing"
							: revision
								? `Preview published revision ${revision}`
								: "No published revision"
					}
					aria-pressed={version === value}
					isDisabled={value === "published" && !revision}
					onPress={() => onSelect(value)}
					className={`h-9 min-w-0 flex-1 gap-1.5 rounded-none px-2 text-[11px] ${adminPanelTabState(version === value)}`}
					startContent={
						<HugeiconsIcon
							icon={
								value === "draft"
									? FileViewIcon
									: CheckmarkBadge01Icon
							}
							size={13}
						/>
					}
				>
					{value === "draft" ? (
						"After publishing"
					) : revision ? (
						<>
							<span>Published</span>
							<span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[9px] font-medium leading-3 tabular-nums text-black/50 dark:bg-white/[0.07] dark:text-white/50">
								Rev {revision}
							</span>
						</>
					) : (
						"Not published"
					)}
				</Button>
			))}
		</div>
	);
}

function ReaderPreview({ tags, title }: { tags: string[]; title: string }) {
	const { content } = useLibraryConfig();
	const reducedMotion = useReducedMotion();
	const previewHidden = hasAnyTag(tags, content.tags.hidden);
	const previewComingSoon = hasAnyTag(tags, content.tags.comingSoon);
	const previewInternal = hasAnyTag(tags, content.tags.internal);
	const hasPreviewBadges = previewComingSoon || previewInternal;
	return (
		<div
			role="region"
			aria-label="Reader preview"
			aria-live="polite"
			className="p-3"
		>
			<div className="mb-2 flex items-center gap-1.5 text-[11px] text-black/50 dark:text-white/50">
				<HugeiconsIcon
					icon={previewHidden ? ViewOffSlashIcon : ViewIcon}
					size={13}
				/>
				{previewHidden
					? "Not listed in the library"
					: "Visible in the library"}
			</div>
			<div
				className={`transition-opacity motion-reduce:transition-none ${previewHidden ? "opacity-35" : "opacity-100"}`}
			>
				<p className="text-[13px] font-semibold leading-5 text-black/85 dark:text-white/85">
					{title}
				</p>
				<AnimatePresence initial={false}>
					{hasPreviewBadges && (
						<motion.div
							key="preview-badges"
							initial={{ height: 0, opacity: 0 }}
							animate={{ height: "auto", opacity: 1 }}
							exit={{ height: 0, opacity: 0 }}
							transition={{
								duration: reducedMotion ? 0 : 0.2,
								ease: "easeOut",
							}}
							className="overflow-hidden"
						>
							<div className="flex flex-wrap gap-1.5 pt-2">
								<PublicationStatusBadges
									comingSoon={previewComingSoon}
									internal={previewInternal}
									comingSoonLabel="Coming soon"
									internalLabel="Available on request"
								/>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}
