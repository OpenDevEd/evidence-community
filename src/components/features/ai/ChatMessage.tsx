"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Cancel01Icon, HashtagIcon, TextFontIcon, Tick01Icon, UserIcon } from "@hugeicons/core-free-icons";

import { Spinner } from "@nextui-org/react";
import { useTranslations } from "next-intl";
import React, { useMemo } from "react";
import { twMerge } from "@/lib/tw-merge";
import { isReasoningUIPart, isTextUIPart, isToolUIPart } from "ai";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getAIModelPresentation } from "@/constants/ai";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import { uiMessageText } from "@/lib/ai/client";
import type { AIModelId } from "@/lib/ai/models";
import {
	isScreeningResultsData,
	screeningExportContent,
	type ScreeningResultsData,
} from "@/lib/ai/screening-export";
import {
	AIGeneratedContentControls,
	AIStructuredContentControls,
	type ControlAction,
	type GeneratedContent,
} from "@/components/features/modals/AIControls";
import { AIMarkdown } from "../markdown/Markdown";
import Resource from "../items/Resource";
import { ToolActivity } from "./ToolActivity";
import { useMessageExport } from "./useChatActions";
import { Tooltip } from "@/components/nextui/Tooltip";

type Message = ResearchUIMessage;

type VisibleMessagePart = {
	key: string;
	part: Message["parts"][number];
};

function parseScreeningResults(messageId: string, content: string) {
	if (!messageId.startsWith("screening-")) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		return isScreeningResultsData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function visibleMessageParts(message: Message): VisibleMessagePart[] {
	let reasoningCount = 0;
	let textCount = 0;

	return message.parts.reduce<VisibleMessagePart[]>((parts, part) => {
		if (isReasoningUIPart(part) && part.text.trim()) {
			reasoningCount += 1;
			parts.push({ key: `reasoning-${reasoningCount}`, part });
		}

		if (isToolUIPart(part)) {
			parts.push({ key: `tool-${part.toolCallId}`, part });
		}

		if (isTextUIPart(part) && part.text.trim()) {
			textCount += 1;
			parts.push({ key: `text-${textCount}`, part });
		}

		return parts;
	}, []);
}

/** The icon that stands for one answer's type, or its yes-or-no value. */
function ScreeningFieldIcon({ type, value }: { type: string; value: unknown }) {
	if (type === "number") return <HugeiconsIcon icon={HashtagIcon} />;
	if (type === "string") return <HugeiconsIcon icon={TextFontIcon} />;

	return value === true ? <HugeiconsIcon icon={Tick01Icon} /> : <HugeiconsIcon icon={Cancel01Icon} />;
}

/** What the screening run found for one publication. */
function ScreeningAnswers({
	fields,
	values,
}: {
	fields: ScreeningResultsData["fields"];
	values: Record<string, unknown>;
}) {
	return (
		<div className="grid grid-cols-1 gap-3 bg-black/[0.025] p-3 dark:bg-black/[0.15] sm:p-4 md:grid-cols-2">
			{fields.map((field, index) => {
				const value = values[field.label] ?? null;
				const isTrue = field.type === "boolean" && value === true;
				// A lone last answer spans both columns instead of leaving a gap.
				const isLastOfOdd =
					fields.length % 2 === 1 && index === fields.length - 1;

				return (
					<section
						key={field.label}
						className={twMerge(
							"min-w-0 rounded-xl bg-white/80 p-4 shadow-card-hairline dark:bg-white/[0.045] dark:shadow-none",
							isLastOfOdd && "md:col-span-2",
						)}
					>
						<div className="flex items-start justify-between gap-3">
							<h3 className="min-w-0 text-xs font-medium leading-5 text-black/50 dark:text-white/50">
								{field.label}
							</h3>
							<Tooltip content={field.type}>
								<span
									className={twMerge(
										"grid size-7 shrink-0 place-items-center rounded-lg bg-black/[0.045] text-sm text-black/40 dark:bg-white/[0.06] dark:text-white/40",
										isTrue &&
											"bg-accent/10 text-accent dark:bg-accent/15 dark:text-accent",
									)}
									role="img"
									aria-label={field.type}
								>
									<ScreeningFieldIcon
										type={field.type}
										value={value}
									/>
								</span>
							</Tooltip>
						</div>
						<p
							className={twMerge(
								"mt-2 break-words text-base font-medium leading-6 text-black/80 dark:text-white/80",
								isTrue && "text-accent dark:text-accent",
							)}
						>
							{String(value)}
						</p>
					</section>
				);
			})}
		</div>
	);
}

function ScreeningResults({ results }: { results: ScreeningResultsData }) {
	const tUI = useTranslations("ui");
	const resultEntries = Object.entries(results.result);
	const formats = useMemo(() => {
		const generated = screeningExportContent(
			results,
			typeof window === "undefined" ? undefined : window.location.origin,
		);
		return {
			plaintext: {
				content: generated.plaintext,
				extension: "txt",
				mimeType: "text/plain;charset=utf-8",
			},
			markdown: {
				content: generated.markdown,
				extension: "md",
				mimeType: "text/markdown;charset=utf-8",
			},
			html: {
				content: generated.html,
				extension: "html",
				mimeType: "text/html;charset=utf-8",
			},
			csv: {
				content: generated.csv,
				extension: "csv",
				mimeType: "text/csv;charset=utf-8",
			},
		} satisfies Record<ControlAction, GeneratedContent>;
	}, [results]);
	const exportControls = (
		<AIStructuredContentControls
			formats={formats}
			downloadName="smart-screening-results"
			appearance="header"
		/>
	);

	return (
		<div className="w-full space-y-4">
			<div className="flex flex-col gap-3 rounded-2xl bg-black/[0.025] p-3 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 px-1">
					<h2 className="text-lg font-medium text-black/80 dark:text-white/80">
						{tUI("smartScreening")}
					</h2>
					<p className="text-xs text-black/45 dark:text-white/45">
						{tUI.rich("resourcesCount", {
							count: resultEntries.length,
							number: (chunks) => chunks,
						})}
					</p>
				</div>
				<div className="flex items-center gap-1 self-end sm:self-auto">
					{exportControls}
				</div>
			</div>

			<div className="space-y-4">
				{resultEntries.map(([resourceId, value]) => (
					<article
						key={resourceId}
						className="overflow-hidden rounded-2xl bg-white/80 shadow-card-lifted dark:bg-white/[0.035]"
					>
						<Resource
							itemKey={resourceId}
							openLinksInNewTab
							abstract={true}
							as="div"
							className="rounded-none bg-transparent dark:bg-transparent [&>div:last-child]:rounded-none"
						/>
						<ScreeningAnswers
							fields={results.fields}
							values={value.screeningFields}
						/>
					</article>
				))}
			</div>

			<div className="flex justify-end rounded-2xl bg-black/[0.025] p-1 dark:bg-white/[0.04]">
				<div className="flex items-center gap-1">{exportControls}</div>
			</div>
		</div>
	);
}

/** Whether the reader can copy or download this answer yet. */
function canExportMessage({
	error,
	hasScreeningResults,
	isStreaming,
	message,
}: {
	error: boolean;
	hasScreeningResults: boolean;
	isStreaming: boolean;
	message: Message;
}) {
	if (message.role !== "assistant") return false;
	if (isStreaming || error || hasScreeningResults) return false;
	if (message.id.includes("error")) return false;

	return message.parts.some((part) => isTextUIPart(part) && part.text.trim());
}

/** The mark beside a message: the reader's own, or the model's. */
function MessageAvatar({
	message,
	modelId,
}: {
	message: Message;
	modelId: AIModelId;
}) {
	const { ai } = useLibraryConfig();
	return (
		<div
			className={twMerge(
				"rounded-full bg-accent dark:bg-accent p-2",
				message.role !== "user" && "hidden",
			)}
		>
			{message.role === "user" ? (
				<HugeiconsIcon icon={UserIcon} className="size-4 text-white" />
			) : (
				React.createElement(
					getAIModelPresentation(modelId, ai.providers).icon,
					{
						className: "size-4 invert shrink-0",
					},
				)
			)}
		</div>
	);
}

/** One piece of an answer: its thinking, a step it took, or its words. */
function AssistantPart({
	isStreaming,
	part,
	pdfSources,
}: {
	isStreaming: boolean;
	part: VisibleMessagePart["part"];
	pdfSources: Record<string, string>;
}) {
	if (isReasoningUIPart(part)) {
		return (
			<div className="mt-4">
				<AIMarkdown
					pdfSources={pdfSources}
					isAnimating={isStreaming}
					className="prose prose-sm max-w-full text-black/50 dark:prose-invert dark:text-white/50 [&_p]:my-1.5 [&_strong]:font-medium [&_strong]:text-black/60 dark:[&_strong]:text-white/60"
				>
					{part.text}
				</AIMarkdown>
			</div>
		);
	}

	if (isToolUIPart(part)) {
		return (
			<div className="mt-2">
				<ToolActivity part={part} />
			</div>
		);
	}

	if (isTextUIPart(part)) {
		return (
			<AIMarkdown
				pdfSources={pdfSources}
				isAnimating={isStreaming}
				className="mt-6 w-full max-w-full space-y-4 p-0 prose dark:prose-invert"
			>
				{part.text}
			</AIMarkdown>
		);
	}

	return null;
}

/** What the message holds, once there is anything to show. */
function MessageBody({
	content,
	isStreaming,
	message,
	pdfSources,
	screeningResults,
	visibleParts,
}: {
	content: string;
	isStreaming: boolean;
	message: Message;
	pdfSources: Record<string, string>;
	screeningResults: ScreeningResultsData | null;
	visibleParts: VisibleMessagePart[];
}) {
	if (screeningResults) {
		return <ScreeningResults results={screeningResults} />;
	}

	if (message.role === "assistant") {
		return visibleParts.map(({ key, part }, index) => (
			<AssistantPart
				key={key}
				isStreaming={isStreaming && index === visibleParts.length - 1}
				part={part}
				pdfSources={pdfSources}
			/>
		));
	}

	if (!content.trim()) return null;

	return (
		<AIMarkdown
			pdfSources={pdfSources}
			isAnimating={isStreaming}
			className="w-full max-w-full space-y-4 p-4 prose dark:prose-invert"
		>
			{content}
		</AIMarkdown>
	);
}

export function MessageComponent({
	message,
	modelId,
	error,
	pdfSources,
	isStreaming,
}: {
	message: Message;
	modelId: AIModelId;
	error: boolean;
	pdfSources: Record<string, string>;
	isStreaming: boolean;
}) {
	const content = uiMessageText(message);
	const visibleParts = visibleMessageParts(message);
	const screeningResults = useMemo(
		() => parseScreeningResults(message.id, content),
		[content, message.id],
	);
	const getMessageContent = useMessageExport(message);
	const showMessageActions = canExportMessage({
		error,
		hasScreeningResults: Boolean(screeningResults),
		isStreaming,
		message,
	});

	return (
		<>
			<MessageAvatar message={message} modelId={modelId} />
			<div
				className={twMerge(
					"p-0 text-wrap max-w-full overflow-hidden break-words text-lg",
					message.role === "user" &&
						"bg-white dark:bg-secondary rounded-xl",
					message.role !== "user" && "w-full",
					message.id.includes("error") &&
						"text-red-500 dark:text-red-500 italic",
				)}
			>
				{visibleParts.length === 0 && !error ? (
					<div className="flex items-center gap-3 p-4">
						<div className="flex w-fit items-center justify-center rounded-full bg-black p-2 opacity-60">
							<Spinner />
						</div>
					</div>
				) : (
					<>
						<MessageBody
							content={content}
							isStreaming={isStreaming}
							message={message}
							pdfSources={pdfSources}
							screeningResults={screeningResults}
							visibleParts={visibleParts}
						/>
						{showMessageActions ? (
							<div className="mt-3 flex items-center gap-0.5">
								<AIGeneratedContentControls
									getContent={getMessageContent}
									downloadName="ai-response"
									appearance="inline"
								/>
							</div>
						) : null}
					</>
				)}
			</div>
		</>
	);
}
