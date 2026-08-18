"use client";

import { ModalBody, ModalContent, ModalFooter, ModalHeader } from "@nextui-org/react";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import DialogModal from "@/components/nextui/DialogModal";

import {
	writebackDialogText,
	type WritebackDialogMode,
	type WritebackDialogOption,
} from "./writeback-selection";

export type WritebackDialogRequest = {
	mode: WritebackDialogMode;
	options: WritebackDialogOption[];
};

/**
 * One dialog for three moments: publish ("Also update"), unpublish ("Also
 * remove from") and the Sources button ("Send future updates to"). It only
 * asks which sources; it never resolves conflicts.
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
			size="md"
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
	return (
		<>
			<ModalHeader>{text.title}</ModalHeader>
			<ModalBody>
				<fieldset
					className="flex flex-col gap-2"
					data-admin-writeback-dialog={request.mode}
				>
					<legend className="mb-2 text-sm text-black/60 dark:text-white/60">
						{text.group}
					</legend>
					{request.options.map((option) => (
						<div className="flex flex-col" key={option.sourceKey}>
							<Checkbox
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
								size="sm"
							>
								{option.sourceLabel}
								{option.isOrigin ? " " : null}
								{option.isOrigin ? (
									<span className="ms-1 rounded-full border border-black/15 px-1.5 text-xs text-black/60 dark:border-white/15 dark:text-white/60">
										Origin
									</span>
								) : null}
							</Checkbox>
							{option.helper ? (
								<span className="ms-8 text-xs text-black/50 dark:text-white/50">
									{option.helper}
								</span>
							) : null}
						</div>
					))}
				</fieldset>
			</ModalBody>
			<ModalFooter>
				<Button
					isDisabled={busy}
					onPress={onClose}
					size="xs"
					variant="transparent"
				>
					Cancel
				</Button>
				<Button
					isDisabled={busy}
					onPress={() => onConfirm([...checked])}
					size="xs"
				>
					{text.confirm}
				</Button>
			</ModalFooter>
		</>
	);
}
