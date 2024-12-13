import { ModalBody, ScrollShadow } from "@nextui-org/react";
import { Modal, ModalContent } from "@nextui-org/react";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";
import { Skeleton } from "@/components/nextui/Skeleton";
import AIHeader from "../ai/AIHeader";
import AIModal from "@/components/nextui/AIModal";
import { visit } from "unist-util-visit";
import { ReactNode } from "react";
import { BiSolidBookBookmark } from "react-icons/bi";

const rehypeBracketWrapper = () => {
	return (tree: any) => {
		visit(tree, "text", (node, index, parent) => {
			if (!node || typeof node.value !== "string") return;

			const regex = /\[((?:pg\.|Section:)\s+([^\]]+))\]/g;

			if (regex.test(node.value)) {
				const parts = [];
				let lastIndex = 0;
				let match;

				regex.lastIndex = 0;

				while ((match = regex.exec(node.value)) !== null) {
					if (match.index > lastIndex) {
						parts.push({ type: "text", value: node.value.slice(lastIndex, match.index) });
					}

					const highlightClass = match[1].startsWith("pg") ? "PageHighlight" : "SectionHighlight";

					parts.push({
						type: "element",
						tagName: "span",
						properties: { className: [highlightClass] },
						children: [{ type: "text", value: match[2] }],
					});

					lastIndex = regex.lastIndex;
				}

				if (lastIndex < node.value.length) {
					parts.push({ type: "text", value: node.value.slice(lastIndex) });
				}

				if (parent && Array.isArray(parent.children)) {
					parent.children.splice(index, 1, ...parts);
				}
			}
		});
	};
};

function Highlight({ children, className }: { children: ReactNode; className: string }) {
	return (
		<span className={`font-semibold inline-flex items-center gap-1 bg-white text-black rounded-md px-1.5 text-sm`}>
			<BiSolidBookBookmark />
			{className === "PageHighlight" ? "Page" : "Section"} {children}
		</span>
	);
}

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
		<AIModal isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent className="pb-4">
				{(onClose) => (
					<>
						<AIHeader isLoading={false} onClose={onClose}>
							{title}
						</AIHeader>
						<ModalBody className="w-full">
							<ScrollShadow  className="w-full h-full">
								<Skeleton
									isLoaded={content.length > 0}
									className="w-full rounded-2xl h-full min-h-64"
								>
									<Markdown
										remarkPlugins={[remarkGfm]}
										rehypePlugins={[rehypeBracketWrapper]}
										components={{
											span: ({ children, className }) =>
												className === "PageHighlight" || className === "SectionHighlight" ? (
													<Highlight className={className}>{children}</Highlight>
												) : (
													<span>{children}</span>
												),
										}}
										className="prose dark:prose-invert space-y-2 max-w-full px-8 py-8"
									>
										{content}
									</Markdown>
								</Skeleton>
							</ScrollShadow>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</AIModal>
	);
}
