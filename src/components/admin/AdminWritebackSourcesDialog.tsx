"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Home01Icon } from "@hugeicons/core-free-icons";
import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Switch } from "@/components/nextui/Switch";

import { SourceProviderIcon } from "./SourceProviderIcon";
import {
	writebackDialogSummary,
	writebackDialogText,
	type WritebackDialogMode,
	type WritebackDialogOption,
} from "./writeback-selection";

export type WritebackDialogRequest = {
	mode: WritebackDialogMode;
	options: WritebackDialogOption[];
};

/**
 * One dialog for three moments: restore, unpublish and the Sources button.
 * The first row is this library, which always takes part; every source
 * below is a switch with one line saying what it has and does today. It
 * only asks which sources; it never resolves conflicts.
 */
export function AdminWritebackSourcesDialog({
	busy,
	onClose,
	onConfirm,
	request,
}: {
	busy: boolean;
	onClose: () => void;
	onConfirm: (sourceKeys: string[]) => void;
	request: WritebackDialogRequest | null;
}) {
	return (
		<DialogModal
			isOpen={request !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			size="lg"
		>
			<ModalContent>
				{request ? (
					<WritebackDialogForm
						busy={busy}
						key={request.mode}
						onClose={onClose}
						onConfirm={onConfirm}
						request={request}
					/>
				) : null}
			</ModalContent>
		</DialogModal>
	);
}

const toneClass = {
	off: "bg-black/30 dark:bg-white/35",
	ok: "bg-emerald-500",
	warn: "bg-amber-500",
} as const;

function WritebackDialogForm({
	busy,
	onClose,
	onConfirm,
	request,
}: {
	busy: boolean;
	onClose: () => void;
	onConfirm: (sourceKeys: string[]) => void;
	request: WritebackDialogRequest;
}) {
	const text = writebackDialogText(request.mode);
	const [checked, setChecked] = useState(
		() =>
			new Set(
				request.options
					.filter((option) => option.checked)
					.map((option) => option.sourceKey),
			),
	);
	const rowClass =
		"flex min-h-[52px] items-center gap-3 border-b border-black/[0.08] py-2.5 dark:border-white/[0.09]";
	return (
		<>
			<ModalHeader className="flex-col items-start gap-1 pb-1">
				<span>{text.title}</span>
				<span className="text-[13px] font-normal leading-5 text-black/60 dark:text-white/60">
					{text.intro}
				</span>
			</ModalHeader>
			<ModalBody className="py-2">
				<div
					className="border-t border-black/[0.08] dark:border-white/[0.09]"
					data-admin-writeback-dialog={request.mode}
					role="group"
				>
					<div className={rowClass} data-admin-writeback-here>
						<span className="grid size-7 shrink-0 place-items-center self-start text-black/70 dark:text-white/70">
							<HugeiconsIcon icon={Home01Icon} aria-hidden size={16} />
						</span>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">This community</p>
							<p className="text-xs text-black/55 dark:text-white/55">
								{text.here}
							</p>
						</div>
						<span className="text-[11px] font-medium text-black/40 dark:text-white/40">
							Always
						</span>
					</div>
					{request.options.map((option) => (
						<div className={rowClass} key={option.sourceKey}>
							<span className="grid size-7 shrink-0 place-items-center self-start text-black/75 dark:text-white/75">
								<SourceProviderIcon provider={option.provider} size={17} />
							</span>
							<div className="min-w-0 flex-1">
								<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
									<span className="truncate">{option.sourceLabel}</span>
									{option.isOrigin ? (
										<span className="shrink-0 rounded border border-black/15 px-1 text-[10.5px] font-normal text-black/60 dark:border-white/15 dark:text-white/60">
											Came from here
										</span>
									) : null}
								</p>
								<p className="flex items-center gap-1.5 text-xs text-black/55 dark:text-white/55">
									<span
										aria-hidden
										className={`size-1.5 shrink-0 rounded-full ${toneClass[option.status.tone]}`}
									/>
									{option.status.text}
								</p>
							</div>
							<Switch
								aria-label={option.sourceLabel}
								color="accent"
								data-admin-writeback-source={option.sourceKey}
								isDisabled={option.disabled || busy}
								isSelected={checked.has(option.sourceKey)}
								onValueChange={(selected) =>
									setChecked((current) => {
										const next = new Set(current);
										if (selected) next.add(option.sourceKey);
										else next.delete(option.sourceKey);
										return next;
									})
								}
							/>
						</div>
					))}
				</div>
			</ModalBody>
			<ModalFooter className="items-center justify-between pt-2">
				<span
					className="text-[12.5px] text-black/60 dark:text-white/60"
					data-admin-writeback-summary
				>
					{writebackDialogSummary(request.mode, checked.size)}
				</span>
				<div className="flex items-center gap-1.5">
					<Button
						isDisabled={busy}
						onPress={onClose}
						size="xs"
						variant="transparent"
					>
						Cancel
					</Button>
					<Button
						color="accent"
						isDisabled={busy}
						onPress={() => onConfirm([...checked])}
						size="xs"
						variant="solid"
					>
						{text.confirm}
					</Button>
				</div>
			</ModalFooter>
		</>
	);
}
