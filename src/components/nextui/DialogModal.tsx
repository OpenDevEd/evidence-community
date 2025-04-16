import { Modal, ModalProps } from "@heroui/react";
import { twMerge } from "tailwind-merge";

export default function DialogModal({classNames, ...props}: ModalProps) {
	return (
		<Modal
			backdrop="blur"
			size="5xl"
			hideCloseButton
			classNames={{
				...classNames,
				base: twMerge("bg-background_light/80 dark:bg-card/80 backdrop-blur-xl border border-black/10 dark:border-white/10", classNames?.base),
			}}
			{...props}
		>
			{props.children}
		</Modal>
	);
}

