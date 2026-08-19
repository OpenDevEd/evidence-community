"use client";

import { Chip, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@nextui-org/react";
import { Link2, Lock, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Tooltip } from "@/components/nextui/Tooltip";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import type {
	AdminItemDetail,
	AdminItemLinkKind,
	AdminLinkTarget,
	AdminSource,
} from "@/lib/admin/types";

import { AdminItemPicker } from "./AdminItemPicker";
import { linkKeysFromPayload } from "./admin-diff";
import { ADMIN_LINK_KINDS, type AdminLinkRowPlan, planAdminLinks } from "./admin-links";
import { firstAdminFieldError } from "./admin-validation";

const OUTGOING_TITLES: Record<AdminItemLinkKind, string> = {
	cites: "Cites",
	related: "Related",
};
const INCOMING_TITLES: Record<AdminItemLinkKind, string> = {
	cites: "Cited by",
	related: "Related to this record",
};
const OUTGOING_HINTS: Record<AdminItemLinkKind, string> = {
	cites: "Records this record cites.",
	related: "Records connected to this record.",
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
				<Lock aria-label="Read only" className="shrink-0 opacity-40" size={11} />
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
			<X aria-hidden size={13} />
		</button>
	);
}

function LinkRow({
	onRemove,
	readOnly,
	row,
}: Readonly<{
	onRemove?: () => void;
	readOnly: boolean;
	row: AdminLinkRowPlan;
}>) {
	const changeLabel = CHANGE_LABELS[row.change];
	return (
		<li
			className={`flex min-h-11 items-center gap-2 rounded-lg bg-black/[0.03] px-2.5 text-xs text-black/70 dark:bg-white/[0.04] dark:text-white/75 ${
				row.change === "removed" ? "opacity-60" : ""
			}`}
			data-admin-link-change={row.change}
			data-admin-link-key={row.key}
			data-admin-link-kind={row.kind}
			data-admin-link-origin={row.origin}
		>
			<Link2
				aria-hidden
				className="shrink-0 text-black/35 dark:text-white/35"
				size={14}
				strokeWidth={1.7}
			/>
			<span className="min-w-0 flex-1">
				<span
					className={`block truncate font-medium ${
						row.change === "removed" ? "line-through" : ""
					}`}
				>
					{row.title}
				</span>
				<span className="block truncate text-[11px] text-black/40 dark:text-white/40">
					{[row.itemType, row.key].filter(Boolean).join(" · ")}
				</span>
			</span>
			{changeLabel ? (
				<Chip
					className="h-5"
					color={row.change === "added" ? "primary" : "default"}
					size="sm"
					variant="flat"
				>
					{changeLabel}
				</Chip>
			) : null}
			{row.deleted ? (
				<Chip className="h-5" size="sm" variant="flat">
					Unpublished
				</Chip>
			) : null}
			{row.sourceLabel ? (
				<Chip className="h-5" size="sm" variant="flat">
					{row.sourceLabel}
				</Chip>
			) : null}
			<LinkRowAction onRemove={onRemove} readOnly={readOnly} row={row} />
		</li>
	);
}

/**
 * Links section of the record editor: two editable lists (Cites, Related) and
 * two read-only lists (Cited by, Related to this record).
 */
export function AdminLinksEditor({
	detail,
	errors,
	onChange,
	payload,
	pickerAutoFocus,
	readOnly,
	sources,
}: Readonly<{
	detail: AdminItemDetail;
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	pickerAutoFocus?: boolean;
	readOnly: boolean;
	sources: AdminSource[];
}>) {
	const [pickerKind, setPickerKind] = useState<AdminItemLinkKind | null>(null);
	const [knownTargets, setKnownTargets] = useState<AdminLinkTarget[]>([]);
	const error = firstAdminFieldError(errors, "links");
	const errorId = `admin-${detail.key}-links-error`;
	const keys = linkKeysFromPayload(payload, detail.links.publishedKeys);
	const plan = planAdminLinks({ keys, knownTargets, links: detail.links, sources });

	const setKeys = (kind: AdminItemLinkKind, next: string[]) => {
		onChange({ ...payload, links: { ...keys, [kind]: next } });
	};

	return (
		<>
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
					return (
						<div key={kind} className="space-y-1.5" data-admin-link-list={kind}>
							<div className="flex items-center justify-between gap-2">
								<h4 className="text-xs font-semibold text-black/60 dark:text-white/65">
									{OUTGOING_TITLES[kind]}
								</h4>
								{!readOnly ? (
									<Button
										onPress={() => setPickerKind(kind)}
										size="xs"
										startContent={<Plus aria-hidden size={13} />}
										variant="transparent"
									>
										Add to {OUTGOING_TITLES[kind]}
									</Button>
								) : null}
							</div>
							{rows.length === 0 ? (
								<p className="flex min-h-9 items-center text-xs text-black/35 dark:text-white/35">
									{OUTGOING_HINTS[kind]} None yet.
								</p>
							) : (
								<ul aria-label={OUTGOING_TITLES[kind]} className="space-y-1">
									{rows.map((row) => (
										<LinkRow
											key={`${row.origin}:${row.key}`}
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
				{ADMIN_LINK_KINDS.map((kind) => {
					const rows = plan.incoming[kind];
					return (
						<div
							key={`incoming-${kind}`}
							className="space-y-1.5"
							data-admin-link-incoming={kind}
						>
							<h4 className="text-xs font-semibold text-black/60 dark:text-white/65">
								{INCOMING_TITLES[kind]}
							</h4>
							{rows.length === 0 ? (
								<p className="flex min-h-9 items-center text-xs text-black/35 dark:text-white/35">
									No records yet.
								</p>
							) : (
								<ul aria-label={INCOMING_TITLES[kind]} className="space-y-1">
									{rows.map((row) => (
										<LinkRow key={`${row.origin}:${row.key}`} readOnly row={row} />
									))}
								</ul>
							)}
						</div>
					);
				})}
			</div>

			<DialogModal
				isOpen={pickerKind !== null}
				onOpenChange={(open) => {
					if (!open) setPickerKind(null);
				}}
				size="md"
			>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader>
								{pickerKind ? `Add to ${OUTGOING_TITLES[pickerKind]}` : "Add link"}
							</ModalHeader>
							<ModalBody>
								{pickerKind ? (
									<AdminItemPicker
										autoFocus={pickerAutoFocus}
										excludeKeys={[
											...keys[pickerKind],
											...plan.outgoing[pickerKind].map((row) => row.key),
										]}
										onPick={(target) => {
											setKnownTargets((current) =>
												current.some((entry) => entry.key === target.key)
													? current
													: [...current, target],
											);
											setKeys(pickerKind, [...keys[pickerKind], target.key]);
											onClose();
										}}
										selfKey={detail.key}
									/>
								) : null}
							</ModalBody>
							<ModalFooter>
								<Button onPress={onClose} size="xs" variant="transparent">
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
