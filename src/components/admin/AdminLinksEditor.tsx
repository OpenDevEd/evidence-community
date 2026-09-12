"use client";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Add01Icon, Cancel01Icon, Link02Icon, LockIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import type {
	AdminItemDetail,
	AdminItemLinkKind,
	AdminLinkTarget,
	AdminSource,
} from "@/lib/admin/types";

import { linkKeysFromPayload } from "./admin-diff";
import { ADMIN_LINK_KINDS, type AdminLinkRowPlan, planAdminLinks } from "./admin-links";
import { firstAdminFieldError } from "./admin-validation";

const OUTGOING_TITLES: Record<AdminItemLinkKind, string> = {
	cites: "Cites",
	related: "Related",
};
const CITED_BY_TITLE = "Cited by";
const OUTGOING_HINTS: Record<AdminItemLinkKind, string> = {
	cites: "Records this record cites.",
	related: "Records connected to this record. Both records show the link and either can remove it.",
};
const CHANGE_LABELS: Record<AdminLinkRowPlan["change"], string | null> = {
	added: "Added in this draft",
	removed: "Removed in this draft",
	unchanged: null,
};

function LinkRowAction({
	onRemove,
	readOnly,
	row,
}: Readonly<{
	onRemove?: () => void;
	readOnly: boolean;
	row: AdminLinkRowPlan;
}>) {
	if (row.origin !== "manual") {
		return (
			<Tooltip content={`Comes from ${row.sourceLabel ?? "a source"}. Change it there.`}>
				<HugeiconsIcon icon={LockIcon} aria-label="Read only" className="shrink-0 opacity-40" size={11} />
			</Tooltip>
		);
	}
	if (!row.removable || readOnly || !onRemove) return null;
	return (
		<button
			aria-label={`Remove ${row.title} from ${OUTGOING_TITLES[row.kind]}`}
			className="grid size-7 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
			onClick={onRemove}
			type="button"
		>
			<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={13} />
		</button>
	);
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
	const titleClassName = `block max-w-full truncate text-left font-medium ${
		row.change === "removed" ? "line-through" : ""
	}`;
	return (
		<li
			className={`flex min-h-11 items-center gap-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-xs text-black/70 dark:bg-white/[0.04] dark:text-white/75 ${
				row.change === "removed" ? "opacity-60" : ""
			}`}
			data-admin-link-change={row.change}
			data-admin-link-key={row.key}
			data-admin-link-kind={row.kind}
			data-admin-link-origin={row.origin}
		>
			<HugeiconsIcon icon={Link02Icon} aria-hidden className="shrink-0 text-black/35 dark:text-white/35" size={14} strokeWidth={1.7} />
			<span className="min-w-0 flex-1">
				{onOpen ? (
					<button
						aria-label={`Open ${row.title}`}
						className={`${titleClassName} w-full rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
						onClick={() => onOpen(row.key)}
						title={row.title}
						type="button"
					>
						{row.title}
					</button>
				) : (
					<span className={titleClassName} title={row.title}>
						{row.title}
					</span>
				)}
				<span className="flex flex-wrap items-center gap-x-2 text-[11px] text-black/40 dark:text-white/40">
					{row.itemType ? <span>{row.itemType}</span> : null}
					<span>{row.key}</span>
					{changeLabel ? <span className="text-accent">{changeLabel}</span> : null}
					{row.deleted ? <span className="text-warning">Unpublished</span> : null}
					{row.sourceLabel ? <span className="min-w-0 truncate" title={row.sourceLabel}>{row.sourceLabel}</span> : null}
				</span>
			</span>
			<LinkRowAction onRemove={onRemove} readOnly={readOnly} row={row} />
		</li>
	);
}

/**
 * Links section of the record editor: two editable lists (Cites, Related — one
 * link shown from both sides) and one read-only list (Cited by).
 * "Add to …" does not open a dialog: it asks the workbench to turn the record
 * table into a picker (`onStartPick`), and rows clicked there are added here.
 */
export function AdminLinksEditor({
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
	const error = firstAdminFieldError(errors, "links");
	const errorId = `admin-${detail.key}-links-error`;
	const keys = linkKeysFromPayload(payload, detail.links.publishedKeys);
	const plan = planAdminLinks({ keys, knownTargets, links: detail.links, sources });

	const setKeys = (kind: AdminItemLinkKind, next: string[]) => {
		onChange({ ...payload, links: { ...keys, [kind]: next } });
	};

	return (
		<div
			aria-describedby={error ? errorId : undefined}
			aria-label="Links"
			className={`space-y-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-danger ${
				error ? "bg-danger/5 p-2" : ""
			}`}
			id={`admin-${detail.key}-links`}
			role="group"
			tabIndex={-1}
		>
			{error ? (
				<p className="text-xs text-danger" id={errorId} role="alert">
					{error}
				</p>
			) : null}
			{ADMIN_LINK_KINDS.map((kind) => {
				const rows = plan.outgoing[kind];
				const picking = pickingKind === kind;
				return (
					<div key={kind} className="space-y-1.5" data-admin-link-list={kind}>
						<div className="flex items-center justify-between gap-2">
							<h4 className="text-xs font-semibold text-black/60 dark:text-white/65">
								{OUTGOING_TITLES[kind]}
							</h4>
							{!readOnly && onStartPick ? (
								<Button
									aria-pressed={picking}
									data-admin-link-pick={kind}
									onPress={() => (picking ? onStopPick?.() : onStartPick(kind))}
									size="xs"
									startContent={<HugeiconsIcon icon={picking ? Tick02Icon : Add01Icon} aria-hidden size={15} />}
									variant="muted"
								>
									{picking ? "Done picking" : `Add to ${OUTGOING_TITLES[kind]}`}
								</Button>
							) : null}
						</div>
						{picking ? (
							<p
								className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs text-black/70 dark:text-white/75"
								role="status"
							>
								Click records in the list to add them under {OUTGOING_TITLES[kind]}.
							</p>
						) : null}
						{rows.length === 0 ? (
							<p className="flex min-h-9 items-center text-xs text-black/35 dark:text-white/35">
								{OUTGOING_HINTS[kind]} None yet.
							</p>
						) : (
							<ul aria-label={OUTGOING_TITLES[kind]} className="space-y-1">
								{rows.map((row) => (
									<LinkRow
										key={`${row.origin}:${row.key}`}
										onOpen={onOpenRecord}
										onRemove={() =>
											setKeys(
												kind,
												keys[kind].filter((key) => key !== row.key),
											)
										}
										readOnly={readOnly}
										row={row}
									/>
								))}
							</ul>
						)}
					</div>
				);
			})}
			<div className="space-y-1.5" data-admin-link-incoming="cites">
				<h4 className="text-xs font-semibold text-black/60 dark:text-white/65">
					{CITED_BY_TITLE}
				</h4>
				{plan.citedBy.length === 0 ? (
					<p className="flex min-h-9 items-center text-xs text-black/35 dark:text-white/35">
						No records yet.
					</p>
				) : (
					<ul aria-label={CITED_BY_TITLE} className="space-y-1">
						{plan.citedBy.map((row) => (
							<LinkRow
								key={`${row.origin}:${row.key}`}
								onOpen={onOpenRecord}
								readOnly
								row={row}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
