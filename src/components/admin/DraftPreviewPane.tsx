"use client";

import { Cancel01Icon, MinusSignIcon, PlusSignIcon, ViewIcon } from "@hugeicons/core-free-icons";
import { ButtonGroup } from "@nextui-org/react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";

/** One pill of flat icon buttons, as the chat composer groups its controls. */
export const ADMIN_BUTTON_GROUP = "shrink-0 overflow-hidden rounded-xl bg-default-100 dark:bg-secondary";
export const ADMIN_GROUP_BUTTON =
	"!h-8 !w-8 !min-w-8 rounded-none border-0 text-black/75 transition-colors hover:bg-default-200 dark:text-white/75 dark:hover:bg-white/[0.08]";
export const ADMIN_GROUP_DIVIDER = "border-l border-black/[0.06] dark:border-white/[0.08]";

const PREVIEW_ZOOMS = [0.5, 0.67, 0.75, 0.9, 1];
export const DEFAULT_PREVIEW_ZOOM = 0.75;

/** The workbench's side of the preview: where it draws, whether it is open, and what the inspector can do with it. */
export type DraftPreview = {
	open: boolean;
	/** The pane the preview draws into, once it has been opened or is about to be. */
	target: HTMLElement | null;
	/** Goes up with each saved draft, so the preview draws the saved version. */
	revision: number;
	zoom: number;
	onZoom: (zoom: number) => void;
	onToggle: () => void;
	/** Draws the preview again, after a change that saves outside the draft. */
	onRefresh: () => void;
	/** Starts loading when the pointer reaches the preview button, so it opens drawn. */
	onPrepare: () => void;
};

/** The review version the inspector shows, when it shows one rather than the working draft. */
export type PreviewReview = { id: string; itemKey: string; revision: number };

/**
 * The public page of the open record, drawn into the workbench's preview pane. Zooming out gives the page a wider
 * window, so it shows the layout a wider screen gets.
 */
export function DraftPreviewPortal({
	preview,
	itemKey,
	review,
	saving,
}: {
	preview: DraftPreview;
	/** The record whose page is shown: an attachment shows its parent's. */
	itemKey: string;
	review?: PreviewReview;
	saving: boolean;
}) {
	// The page fades in once drawn, so a record's first opening shows no empty frame. The inspector mounts this anew for
	// each record and version.
	const [loaded, setLoaded] = useState(false);
	// A closed preview keeps the version it last showed, so autosaves don't rebuild a page nobody is looking at.
	const version = review?.revision ?? preview.revision;
	const [shownVersion, setShownVersion] = useState(version);
	if (preview.open && shownVersion !== version) setShownVersion(version);
	// A frame loads once per record or review. Later versions reach it through its version attribute, and the page
	// refreshes in place instead of reloading, so saving doesn't blank the frame or reset its scroll.
	const page = review ? `${review.itemKey}:${review.id}` : itemKey;
	const [frame, setFrame] = useState({ page, version: shownVersion });
	if (frame.page !== page) setFrame({ page, version: shownVersion });
	if (!preview.target) return null;
	// Under the admin's own locale prefix, so the page reads in the language the admin is using. The pane only exists
	// in the browser, so its location is there to read.
	const adminPath = location.pathname;
	const previewPath = `${adminPath.slice(0, adminPath.indexOf("/admin"))}/admin/preview`;
	const { zoom, onZoom } = preview;
	const step = PREVIEW_ZOOMS.indexOf(zoom);
	const src = review
		? `${previewPath}/${review.itemKey}?review=${review.id}&v=${frame.version}`
		: `${previewPath}/${itemKey}?v=${frame.version}`;
	const label = review ? "Preview of the submitted version" : "Preview of the working draft";
	return createPortal(
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-2 dark:border-white/[0.06]">
				<span className="flex min-w-0 items-center gap-2 text-sm font-medium text-black/75 dark:text-white/75">
					<HugeiconsIcon icon={ViewIcon} aria-hidden size={15} className="shrink-0 text-accent" />
					<span className="truncate">{label}</span>
					{saving ? <span className="shrink-0 text-xs font-normal text-black/45 dark:text-white/45">Saving…</span> : null}
				</span>
				<div className="flex shrink-0 items-center gap-2">
					<ButtonGroup aria-label="Preview zoom" className={ADMIN_BUTTON_GROUP}>
						<Tooltip content="Zoom out">
							<Button aria-label="Zoom out" isIconOnly isDisabled={step === 0} onPress={() => onZoom(PREVIEW_ZOOMS[step - 1])} size="xs" variant="transparent" className={ADMIN_GROUP_BUTTON}>
								<HugeiconsIcon icon={MinusSignIcon} aria-hidden size={14} />
							</Button>
						</Tooltip>
						<Tooltip content="Reset zoom">
							<Button aria-label={`Zoom ${Math.round(zoom * 100)}%, reset`} onPress={() => onZoom(DEFAULT_PREVIEW_ZOOM)} size="xs" variant="transparent" className={`${ADMIN_GROUP_BUTTON} !w-12 !min-w-12 border-x border-black/[0.06] px-0 text-xs font-medium tabular-nums dark:border-white/[0.08]`}>
								{Math.round(zoom * 100)}%
							</Button>
						</Tooltip>
						<Tooltip content="Zoom in">
							<Button aria-label="Zoom in" isIconOnly isDisabled={step === PREVIEW_ZOOMS.length - 1} onPress={() => onZoom(PREVIEW_ZOOMS[step + 1])} size="xs" variant="transparent" className={ADMIN_GROUP_BUTTON}>
								<HugeiconsIcon icon={PlusSignIcon} aria-hidden size={14} />
							</Button>
						</Tooltip>
					</ButtonGroup>
					<Tooltip content="Close preview">
						<Button aria-label="Close preview" isIconOnly onPress={preview.onToggle} size="xs" variant="muted" className="h-8 w-8 min-w-8 rounded-xl">
							<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={14} />
						</Button>
					</Tooltip>
				</div>
			</div>
			<div className="relative min-h-0 flex-1 overflow-hidden bg-background">
				<iframe
					key={src}
					src={src}
					data-version={shownVersion}
					title={label}
					onLoad={() => setLoaded(true)}
					className={`absolute left-0 top-0 origin-top-left bg-background transition-opacity duration-200 motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
					style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}
				/>
			</div>
		</div>,
		preview.target,
	);
}
