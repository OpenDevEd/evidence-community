import { ModalBody } from "@nextui-org/react";
import { Modal, ModalContent } from "@nextui-org/react";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";
import { Skeleton } from "@/components/nextui/Skeleton";
import AIHeader from "../ai/AIHeader";
import AIModal from "@/components/nextui/AIModal";

export default function GenerativeModal({
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
		<AIModal
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<ModalContent className="pb-4">
				{(onClose) => (
					<>
						<AIHeader isLoading={false} onClose={onClose}>
							{title}
						</AIHeader>
						<ModalBody className="w-full">
							<Skeleton
								isLoaded={content.length > 0}
								className="w-full h-full rounded-2xl min-h-64"
							>
								<Markdown remarkPlugins={[remarkGfm]} className="prose dark:prose-invert space-y-2">
									{content}
								</Markdown>
							</Skeleton>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</AIModal>
	);
}
