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
				backdrop: "max-sm:bg-background_light-400 max-sm:dark:bg-background-400",
				base: "bg-background_light/80 dark:bg-card/80 backdrop-blur-xl sm:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none outline-none sm:rounded-large min-h-dvh xl:min-h-0",
			}}
			{...props}
		>
			{props.children}
		</Modal>
	);
}

