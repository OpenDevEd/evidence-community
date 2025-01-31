import { Modal, ModalProps } from "@nextui-org/react";

export default function DialogModal(props: ModalProps) {
	return (
		<Modal
			backdrop="blur"
			size="5xl"
			hideCloseButton
			classNames={{
				base: "bg-background_light/80 dark:bg-card/80 backdrop-blur-xl border border-black/10 dark:border-white/10",
			}}
			{...props}
		>
			{props.children}
		</Modal>
	);
}

