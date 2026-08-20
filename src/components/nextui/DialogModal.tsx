import { Modal, ModalProps } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";

export default function DialogModal({classNames, ...props}: ModalProps) {
	return (
		<Modal
			backdrop="opaque"
			size="5xl"
			hideCloseButton
			classNames={{
				...classNames,
				base: twMerge("bg-background_light dark:bg-card border border-black/10 dark:border-white/10", classNames?.base),
			}}
			{...props}
		>
			{props.children}
		</Modal>
	);
}
