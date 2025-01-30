import { Modal, ModalProps } from "@nextui-org/react";

export default function DialogModal(props: ModalProps) {
	return (
		<Modal
			backdrop="blur"
			size="5xl"
			hideCloseButton
			classNames={{
				base: "bg-background_light/80 dark:bg-card/80 backdrop-blur-xl border border-black/10 dark:border-white/10 rounded-none outline-none rounded-large shadow-[0_0_10px_0_rgba(0,0,0,0.1)] shadow-none",
			}}
			{...props}
		>
			{props.children}
		</Modal>
	);
}

