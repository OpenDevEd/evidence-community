import { ModalBody, ScrollShadow } from "@nextui-org/react";
import { Modal, ModalContent } from "@nextui-org/react";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";
import { Skeleton } from "@/components/nextui/Skeleton";
import AIHeader from "../ai/AIHeader";
import AIModal from "@/components/nextui/AIModal";
import { visit } from "unist-util-visit";
import { ReactNode } from "react";
import { BiSolidBookBookmark, BiSolidBookContent } from "react-icons/bi";
import { Node } from "unist";
import { AIMarkdown } from "../ai/Markdown";
import { motion, MotionConfig } from "framer-motion";
import { useTranslations } from "next-intl";


export default function GenerativeModal({
	isOpen,
	onOpenChange,
	content,
	title,
	error,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	content: string;
	title: string;
	error?: Error;
}) {
	const t = useTranslations("ai");

	return (
		<AIModal isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent className="pb-4">
				{(onClose) => (
					<>
						<AIHeader isLoading={false} onClose={onClose}>
							{title}
						</AIHeader>
						<ModalBody className="w-full">
							<ScrollShadow className="w-full h-full">
								<Skeleton
									isLoaded={content.length > 0 || !!error}
									className="w-full rounded-2xl h-full min-h-64 relative"
								>
									{error ? (
										<div
											className="text-red-500 flex items-center justify-center text-xl absolute inset-0 bg-red-500/10 rounded-2xl text-center px-24 text-balance overflow-hidden "
										>
											<motion.div
												initial={{ opacity: 0, y: -100 }}
												animate={{ opacity: 1, y: 0 }}
												exit={{ opacity: 0, y: 100 }}
												transition={{ delay: 0.5 }}
											>
												{t("errorMessage")}
											</motion.div>
										</div>
									) : (
										<AIMarkdown
											className="prose dark:prose-invert space-y-2 max-w-full px-4 py-2"
										>
											{content}
										</AIMarkdown>
									)}
								</Skeleton>
							</ScrollShadow>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</AIModal>
	);
}
