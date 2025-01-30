import { Modal, ModalProps } from "@nextui-org/react";

export default function FullScreenModal(props: ModalProps) {
	return (
		<Modal
			backdrop="blur"
			size="5xl"
			scrollBehavior="inside"
			placement="top-center"
			hideCloseButton
			classNames={{
				base: "bg-background_light/80 dark:bg-card/80 backdrop-blur-xl xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none outline-none xl:rounded-large min-h-dvh xl:min-h-0 shadow-[0_0_10px_0_rgba(0,0,0,0.1)] shadow-none",
			}}
			{...props}
		>
			{props.children}
		</Modal>
	);
}

