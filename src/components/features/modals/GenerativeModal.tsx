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

function createRehypeWrapper(pattern: RegExp, className: string) {
	return () => (tree: Node) => {
		visit(tree, 'text', (node: any, index: number, parent: any) => {
			const { value } = node;
			let match;
			const nodes = [];
			let lastIndex = 0;

			while ((match = pattern.exec(value)) !== null) {
				const [fullMatch, captured] = match;
				const start = match.index;

				if (start > lastIndex) {
					nodes.push({
						type: 'text',
						value: value.slice(lastIndex, start),
					});
				}

				nodes.push({
					type: 'element',
					tagName: 'span',
					properties: { className: [className] },
					children: [{ type: 'text', value: captured }],
				});

				lastIndex = pattern.lastIndex;
			}

			if (lastIndex < value.length) {
				nodes.push({
					type: 'text',
					value: value.slice(lastIndex),
				});
			}

			if (nodes.length > 0) {
				parent.children.splice(index, 1, ...nodes);
				return index + nodes.length;
			}
		});
	};
}

function createRehypeWrapperForTag(tag: string, className: string) {
	const regex = new RegExp(`\\[${tag} (.*?) ${tag}\\/\\.?\\]\\.?`, 'g');
	return createRehypeWrapper(regex, className);
}

const rehypeQuoteWrapper = createRehypeWrapperForTag("QUOTE", "QuoteHighlight");
const rehypePageWrapper = createRehypeWrapperForTag("PAGE", "PageHighlight");
const rehypeSectionWrapper = createRehypeWrapperForTag("SECTION", "SectionHighlight");

function Highlight({ children, className }: { children: ReactNode; className: string }) {
	if (className === "PageHighlight") {
		return (
			<span className="font-medium inline-flex items-center gap-1 bg-gray-800/50 text-gray-200 border border-gray-700 rounded-md px-2 py-0.5 text-xs ml-1">
				<BiSolidBookBookmark className="text-tertiary-400" />
				<span className="text-gray-400 text-xs font-normal">Page</span>
				<span className="text-gray-200 text-sm font-medium">{children}</span>
			</span>
		);
	}

	// For SectionHighlight
	return (
		<span className="font-medium inline-flex items-center gap-1 bg-gray-800/50 text-gray-200 border border-gray-700 rounded-md px-2 py-0.5 text-xs ml-1">
			<BiSolidBookContent className="text-accent-400" />
			<span className="text-gray-400 text-xs font-normal">Section</span>
			<span className="text-gray-200 text-sm font-medium">{children}</span>
		</span>
	);
}

function QuoteHighlight({ children }: { children: ReactNode }) {
	return (
		<blockquote className="italic font-normal text-gray-200 border-l-4 border-gray-500 pl-3 py-1 my-1 block">
			{children}
		</blockquote>
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
	console.log(content);

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
									isLoaded={content.length > 0}
									className="w-full rounded-2xl h-full min-h-64"
								>
									<Markdown
										remarkPlugins={[remarkGfm]}
										rehypePlugins={[rehypeQuoteWrapper, rehypePageWrapper, rehypeSectionWrapper]}
										components={{
											span: ({ children, className }) =>
												className === "PageHighlight" || className === "SectionHighlight" ? (
													<Highlight className={className}>{children}</Highlight>
												) : className === "QuoteHighlight" ? (
													<QuoteHighlight>{children}</QuoteHighlight>
												) : (
													<span>{children}</span>
												),
										}}
										className="prose dark:prose-invert space-y-2 max-w-full px-4 py-2"
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
