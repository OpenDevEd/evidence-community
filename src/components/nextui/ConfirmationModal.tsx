import { ModalBody, ModalContent, ModalFooter } from "@nextui-org/react";
import type { ReactNode } from "react";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";

export function ConfirmationModal({
	isOpen,
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel,
	onConfirm,
	extra,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	/** Another way on, beside cancel and confirm. */
	extra?: ReactNode;
}) {
	return (
		<DialogModal size="sm" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent>
				<ModalBody className="gap-2 px-6 pb-2 pt-6 text-center">
					<h2 className="text-xl font-semibold">{title}</h2>
					<p className="text-sm text-black/60 dark:text-white/60">
						{description}
					</p>
				</ModalBody>
				{extra ? (
					// Three ways on stack full width, the confirmation first, as iOS lays out an alert with more than two.
					<ModalFooter className="flex-col gap-2 px-6 pb-6 pt-3 [&>*]:w-full">
						<Button color="accent" onPress={onConfirm}>
							{confirmLabel}
						</Button>
						{extra}
						<Button variant="transparent" onPress={() => onOpenChange(false)}>
							{cancelLabel}
						</Button>
					</ModalFooter>
				) : (
					<ModalFooter className="justify-center gap-2 px-6 pb-6 pt-3">
						<Button
							variant="transparent"
							onPress={() => onOpenChange(false)}
						>
							{cancelLabel}
						</Button>
						<Button color="accent" onPress={onConfirm}>
							{confirmLabel}
						</Button>
					</ModalFooter>
				)}
			</ModalContent>
		</DialogModal>
	);
}
