"use client";
import { useState, type ReactNode } from "react";
import { InspectorChoices } from "./InspectorChoices";
import { InspectorSection } from "./InspectorSection";
import { InspectorListRow, InspectorListRemove } from "./InspectorListRow";
import { humanizeAdminField } from "./admin-schema";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Add01Icon, Link02Icon, SquareLock01Icon, Tick02Icon, ArrowUpRight01Icon, ArrowDownLeft01Icon, File02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import type {
	AdminItemDetail,
	AdminItemLinkKind,
	AdminLinkTarget,
	AdminSource,
} from "@/lib/admin/types";

import { linkKeysFromPayload } from "./admin-diff";
import { type AdminLinkRowPlan, planAdminLinks } from "./admin-links";
import { firstAdminFieldError } from "./admin-validation";

const OUTGOING_TITLES: Record<AdminItemLinkKind, string> = {
	cites: "Cites",
	related: "Related",
};
const CITED_BY_TITLE = "Cited by";
const CHANGE_LABELS: Record<AdminLinkRowPlan["change"], string | null> = {
	added: "Added in this draft",
	removed: "Removed in this draft",
	unchanged: null,
};

function linkRowActions(row: AdminLinkRowPlan, readOnly: boolean, onRemove?: () => void) {
	return row.origin !== "manual" ? (
		<Tooltip content={`Comes from ${row.sourceLabel ?? "a source"}. Change it there.`}>
			<HugeiconsIcon icon={SquareLock01Icon} aria-label="Read only" className="shrink-0 opacity-40" size={11} />
		</Tooltip>
	) : row.removable && !readOnly && onRemove ? (
		<InspectorListRemove
			label={`Remove ${row.title} from ${OUTGOING_TITLES[row.kind]}`}
			onRemove={onRemove}
		/>
	) : undefined;
}

function LinkRow({
	onOpen,
	onRemove,
	readOnly,
	row,
}: Readonly<{
	/** Open the linked record in the editor. */
	onOpen?: (key: string) => void;
	onRemove?: () => void;
	readOnly: boolean;
	row: AdminLinkRowPlan;
}>) {
	const changeLabel = CHANGE_LABELS[row.change];

	return (
		<InspectorListRow
			icon={File02Icon}
			title={row.title}
			removed={row.change === "removed"}
			onOpen={onOpen ? () => onOpen(row.key) : undefined}
			data-admin-link-change={row.change}
			data-admin-link-key={row.key}
			data-admin-link-kind={row.kind}
			data-admin-link-origin={row.origin}
			description={
				<span className="flex min-w-0 items-center gap-1.5">
					{row.itemType && <TruncatedText text={humanizeAdminField(row.itemType)} className="font-medium" focusable={!onOpen} />}
					<span className="shrink-0 font-mono text-[10px] text-black/30 dark:text-white/30" aria-label={`Item key ${row.key}`}>{row.key}</span>
					{row.sourceLabel && <TruncatedText text={row.sourceLabel} focusable={!onOpen} />}
				</span>
			}
			status={changeLabel || row.deleted ? (
				<>
					{changeLabel && <span className="text-accent">{changeLabel}</span>}
					{row.deleted && <span className="text-warning">Unpublished</span>}
				</>
			) : undefined}
			actions={linkRowActions(row, readOnly, onRemove)}
		/>
	);
}

function LinkList({
	rows, kind, label, readOnly, onOpen, onRemove,
}: {
	rows: AdminLinkRowPlan[];
	kind: AdminItemLinkKind | "citedBy";
	label: string;
	readOnly: boolean;
	onOpen?: (key: string) => void;
	onRemove: (key: string) => void;
}) {
	if (!rows.length) return null;
	return (
		<ul aria-label={label} className="space-y-1.5" data-admin-link-list={kind}>
			{rows.map(row => (
				<LinkRow
					key={`${row.origin}:${row.key}`}
					onOpen={onOpen}
					onRemove={() => onRemove(row.key)}
					readOnly={readOnly}
					row={row}
				/>
			))}
		</ul>
	);
}

function LinkPickButton({
	kind, label, picking, readOnly, onPress,
}: {
	kind: AdminItemLinkKind;
	label: string;
	picking: boolean;
	readOnly: boolean;
	onPress: () => void;
}) {
	return (
		<Button
			aria-label={picking ? "Done picking links" : `Add to ${label}`}
			aria-pressed={picking}
			data-admin-link-pick={kind}
			isDisabled={readOnly}
			onPress={onPress}
			size="xs"
			startContent={<HugeiconsIcon icon={picking ? Tick02Icon : Add01Icon} aria-hidden size={15} />}
			variant="muted"
		>
			{picking ? "Done picking" : "Add link"}
		</Button>
	);
}

/**
 * Links section of the record editor: two editable lists (Cites, Related — one
 * link shown from both sides) and one read-only list (Cited by).
 * "Add link" does not open a dialog: it asks the workbench to turn the record
 * table into a picker (`onStartPick`), and rows clicked there are added here.
 */
export function AdminLinksEditor({
	actions,
	detail,
	errors,
	knownTargets = [],
	onChange,
	onOpenRecord,
	onStartPick,
	onStopPick,
	payload,
	pickingKind = null,
	readOnly,
	sources,
}: Readonly<{
	actions?: ReactNode;
	detail: AdminItemDetail;
	errors: AdminFieldErrors;
	/** Titles for records the table already knows, so freshly picked rows show a title. */
	knownTargets?: readonly AdminLinkTarget[];
	onChange: (payload: Record<string, unknown>) => void;
	/** Open a linked record in the editor (clicking a row title). */
	onOpenRecord?: (key: string) => void;
	/** Turn the record table into a picker for this kind. */
	onStartPick?: (kind: AdminItemLinkKind) => void;
	onStopPick?: () => void;
	payload: Record<string, unknown>;
	/** Which kind the table is currently picking for, if any. */
	pickingKind?: AdminItemLinkKind | null;
	readOnly: boolean;
	sources: AdminSource[];
}>) {
	const [selectedKind, setSelectedKind] = useState<AdminItemLinkKind | "citedBy">("cites");
	const activeKind = pickingKind ?? selectedKind;
	const error = firstAdminFieldError(errors, "links");
	const errorId = `admin-${detail.key}-links-error`;
	const keys = linkKeysFromPayload(payload, detail.links.publishedKeys);
	const plan = planAdminLinks({ keys, knownTargets, links: detail.links, sources });

	const setKeys = (kind: AdminItemLinkKind, next: string[]) => {
		onChange({ ...payload, links: { ...keys, [kind]: next } });
	};

	const tabs = [
		{ key: "cites", label: "Cites", icon: ArrowUpRight01Icon, rows: plan.outgoing.cites },
		{ key: "related", label: "Related", icon: Link02Icon, rows: plan.outgoing.related },
		{ key: "citedBy", label: CITED_BY_TITLE, icon: ArrowDownLeft01Icon, rows: plan.citedBy },
	] as const;
	const active = tabs.find(({ key }) => key === activeKind)!;
	const picking = pickingKind !== null;
	function removeLink(key: string) {
		if (readOnly || activeKind === "citedBy") return;
		setKeys(activeKind, keys[activeKind].filter(candidate => candidate !== key));
	}
	function togglePicking() {
		if (picking) onStopPick?.();
		else if (activeKind !== "citedBy") onStartPick?.(activeKind);
	}
	return (
		<InspectorSection
			icon={Link02Icon}
			title="Links"
			actions={actions}
		>
			<div
				aria-describedby={error ? errorId : undefined}
				aria-label="Links"
				className={`space-y-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-danger ${error ? "bg-danger/5 p-2" : ""}`}
				id={`admin-${detail.key}-links`}
				role="group"
				tabIndex={-1}
			>
				<InspectorChoices
					label="Link type"
					variant="inset"
					value={activeKind}
					onChange={(kind) => { onStopPick?.(); setSelectedKind(kind); }}
					options={tabs.map(({ key, label, icon, rows }) => ({
						key,
						label,
						content: <><HugeiconsIcon icon={icon} size={13} aria-hidden /><span className="whitespace-nowrap">{label}</span><span className="tabular-nums opacity-50">{rows.filter(row => row.change !== "removed").length}</span></>,
					}))}
				/>
				{error && <p className="text-xs text-danger" id={errorId} role="alert">{error}</p>}
				<LinkList
					rows={active.rows}
					kind={activeKind}
					label={active.label}
					readOnly={readOnly || activeKind === "citedBy"}
					onOpen={onOpenRecord}
					onRemove={removeLink}
				/>
				{onStartPick && activeKind !== "citedBy" && (
					<LinkPickButton kind={activeKind} label={active.label} picking={picking} readOnly={readOnly} onPress={togglePicking} />
				)}
			</div>
		</InspectorSection>
	);
}
