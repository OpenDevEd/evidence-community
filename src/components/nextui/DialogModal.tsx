import { Modal, type ModalProps } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";

export default function DialogModal({
	classNames,
	size = "md",
	...props
}: ModalProps) {
	return (
		<Modal
			backdrop="opaque"
			classNames={{
				...classNames,
				base: twMerge(
					"border border-black/10 bg-background_light dark:border-white/10 dark:bg-card",
					size === "full" ? "" : "w-dialog sm:w-full",
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
