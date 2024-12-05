import { SectionTitle } from "@/components/typography/SectionTitle";
import { ModalBody } from "@nextui-org/react";
import { Modal, ModalContent, ModalHeader } from "@nextui-org/react";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";
import { LuX } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { Skeleton } from "@/components/nextui/Skeleton";
import { BsStars } from "react-icons/bs";

export default function AIModal({
	isOpen,
	onOpenChange,
	content,
	title,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	content: string;
	title: string;
}) {
	return (
		<Modal
			size="4xl"
			scrollBehavior="inside"
			placement="top-center"
			hideCloseButton
			classNames={{
				base: "bg-background_light/80 dark:bg-card/80 backdrop-blur-xl xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none outline-none xl:rounded-large min-h-dvh xl:min-h-0 shadow-[0_0_10px_0_rgba(0,0,0,0.1)] shadow-accent",
			}}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent className="pb-4">
				{(onClose) => (
					<>
						<ModalHeader className="flex items-center justify-between gap-2">
							<SectionTitle>
								<div className="flex items-center gap-2 text-accent">
									<BsStars />
									<span className="bg-gradient-to-r from-accent to-accent-800 bg-clip-text text-transparent">
										{title}
									</span>
								</div>
							</SectionTitle>
							<Button
								onClick={onClose}
								isIconOnly
								variant="transparent"
								className="xl:px-0 px-0 translate-x-2"
								startContent={
									<LuX className="size-6 text-black dark:text-white/80" />
								}
							/>
						</ModalHeader>
						<ModalBody className="w-full">
							<Skeleton
								isLoaded={content.length > 0}
								className="w-full h-full rounded-2xl text-lg min-h-64"
							>
								<Markdown remarkPlugins={[remarkGfm]}>
									{content}
								</Markdown>
							</Skeleton>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</Modal>
	);
}
