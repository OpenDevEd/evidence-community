import { ModalBody, ModalContent, ModalFooter } from "@nextui-org/react";

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
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
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
			</ModalContent>
		</DialogModal>
	);
}
