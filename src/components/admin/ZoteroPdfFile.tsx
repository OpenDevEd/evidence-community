"use client";

import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
	Clock01Icon,
	CloudUploadIcon,
	FileXIcon,
	SentIcon,
	Tag01Icon,
	Tick01Icon,
	Undo02Icon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { hasAnyTag } from "@/lib/tags";
import type { AdminItemDetail, AdminSource } from "@/lib/admin/types";

/**
 * A Zotero attachment's PDF and the library's own say over it: an editor can take a published PDF down, or publish
 * one its tags don't, and the change goes through review like any other. The library keeps the choice; Zotero never
 * sees it.
 *
 * Mock: the source's rule comes from `?pdfs=every` until it is a source setting, and the editor's change and its
 * review live in this browser only.
 */
type Change = "publish" | "takeDown";
type Override = { change: Change; submitted: boolean } | null;

const overrides = new Map<string, Override>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
function setOverride(key: string, next: Override) {
	overrides.set(key, next);
	for (const listener of listeners) listener();
}
function useOverride(key: string) {
	return useSyncExternalStore(subscribe, () => overrides.get(key) ?? null, () => null);
}

const tone = {
	live: "text-emerald-700 dark:text-emerald-300",
	off: "text-black/40 dark:text-white/40",
	pending: "text-accent-300 dark:text-accent-700",
	review: "text-amber-700 dark:text-amber-300",
};

function Chip({ icon, label, className }: { icon: IconSvgElement; label: string; className: string }) {
	return (
		<span className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium ${className}`}>
			<HugeiconsIcon icon={icon} aria-hidden size={12} strokeWidth={2} />
			{label}
		</span>
	);
}

function TagChips({ tags }: { tags: readonly string[] }) {
	return (
		<span className="inline-flex flex-wrap gap-1">
			{tags.map((tag) => (
				<span key={tag} className="rounded-md bg-black/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-black/70 dark:bg-white/[0.07] dark:text-white/70">
					{tag}
				</span>
			))}
		</span>
	);
}

export function isZoteroPdf(detail: AdminItemDetail, source: AdminSource | undefined) {
	const published = detail.published ?? {};
	return source?.provider === "zotero" && detail.itemType === "Attachment" && published.contentType === "application/pdf";
}

export function ZoteroPdfFile({ detail, source }: { detail: AdminItemDetail; source: AdminSource }) {
	const { content } = useLibraryConfig();
	const every = useSearchParams().get("pdfs") === "every";
	const override = useOverride(detail.key);
	const publishTags = content.tags.publish;
	const matched = publishTags.filter((tag) => detail.tags.includes(tag));
	const byRule = every || hasAnyTag(detail.tags, publishTags);
	const filename = typeof detail.published?.filename === "string" ? detail.published.filename : detail.title;

	const status = override?.submitted
		? { icon: Clock01Icon, label: "In review", className: tone.review }
		: override?.change === "publish"
			? { icon: CloudUploadIcon, label: "To publish", className: tone.pending }
			: override?.change === "takeDown"
				? { icon: ViewOffSlashIcon, label: "To take down", className: tone.pending }
				: byRule
					? { icon: Tick01Icon, label: "PDF live", className: tone.live }
					: { icon: FileXIcon, label: "Not published", className: tone.off };

	return (
		<div className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]" data-admin-file-row="zotero">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-black/80 dark:text-white/80">{filename}</p>
					<p className="mt-1 text-black/45 dark:text-white/45">Zotero file</p>
				</div>
				<Chip {...status} />
			</div>

			<div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-black/55 dark:text-white/55">
				<HugeiconsIcon icon={Tag01Icon} aria-hidden size={13} className="shrink-0" />
				{every ? (
					<span>Every PDF in {source.label} is published</span>
				) : matched.length > 0 ? (
					<>
						<span>Published by its tag</span>
						<TagChips tags={matched} />
					</>
				) : (
					<>
						<span>Needs one of</span>
						<TagChips tags={publishTags} />
					</>
				)}
			</div>

			{/* One line in every state, so an action never moves what is below the row. */}
			<p className="mt-2 truncate text-black/45 dark:text-white/45">
				{override?.submitted
					? `${override.change === "publish" ? "Publishes" : "Comes down"} once approved in the Review queue.`
					: override
						? "Only the library changes. Zotero stays as it is."
						: byRule
							? every ? "Take it down here if it shouldn't be public." : "Take it down here, or remove its tag in Zotero."
							: "Publish it here, or tag it in Zotero."}
			</p>

			<div className="mt-2 flex flex-wrap gap-1">
				{override?.submitted ? (
					<Button size="xs" variant="transparent" className="h-8" onPress={() => setOverride(detail.key, { ...override, submitted: false })}
						startContent={<HugeiconsIcon icon={Undo02Icon} aria-hidden size={14} />}>
						Withdraw
					</Button>
				) : override ? (
					<>
						<Button size="xs" variant="muted" className="h-8" onPress={() => setOverride(detail.key, { ...override, submitted: true })}
							startContent={<HugeiconsIcon icon={SentIcon} aria-hidden size={14} />}>
							Submit for review
						</Button>
						<Button size="xs" variant="transparent" className="h-8" onPress={() => setOverride(detail.key, null)}
							startContent={<HugeiconsIcon icon={Undo02Icon} aria-hidden size={14} />}>
							Undo
						</Button>
					</>
				) : byRule ? (
					<Button size="xs" variant="transparent" className="h-8" onPress={() => setOverride(detail.key, { change: "takeDown", submitted: false })}
						startContent={<HugeiconsIcon icon={ViewOffSlashIcon} aria-hidden size={14} />}>
						Take down PDF
					</Button>
				) : (
					<Button size="xs" variant="transparent" className="h-8" onPress={() => setOverride(detail.key, { change: "publish", submitted: false })}
						startContent={<HugeiconsIcon icon={CloudUploadIcon} aria-hidden size={14} />}>
						Publish PDF
					</Button>
				)}
			</div>
		</div>
	);
}
