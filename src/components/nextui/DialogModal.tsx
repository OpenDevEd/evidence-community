import { Modal, type ModalProps } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";

export default function DialogModal({
	classNames,
	size = "md",
	...props
}: ModalProps) {
	return (
		<Modal
			backdrop="blur"
			classNames={{
				...classNames,
				base: twMerge(
					"border border-black/10 bg-background_light/80 backdrop-blur-xl dark:border-white/10 dark:bg-card/80",
					classNames?.base,
				),
			}}
			hideCloseButton
			size={size}
			{...props}
		>
			{props.children}
		</Modal>
	);
}
