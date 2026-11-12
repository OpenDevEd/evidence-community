"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { publicationsAsked } from "@/lib/ai/request-context";
import { ArrowDown01Icon, Cancel01Icon, Loading03Icon, ReloadIcon } from "@hugeicons/core-free-icons";

import { useDisclosure } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";

import ModelSelector from "@/components/features/ai/ModelSelector";
import { ScreeningLimitConfirmation } from "@/components/features/ai/ScreeningLimitConfirmation";
import { AIGeneratedContentControls } from "@/components/features/modals/AIControls";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { SHORTCUT_KEYS } from "@/constants/shortcuts";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import type { AIModelId } from "@/lib/ai/models";
import type { LibrarySearchContext } from "@/lib/search-context";
import { MessageComponent } from "./ChatMessage";
import { CitedPublications } from "../markdown/Citation";
import {
	ChatComposerControls,
	ChatComposerShell,
} from "./ChatComposerControls";
import { ChatErrorCard, ShortcutHint } from "./chat-shared";
import { SmartScreeningModal } from "./SmartScreeningModal";
import { useInlineChat, useInlineChatComposer } from "./useInlineChat";
import { AttachedRow } from "./AttachedRow";
import { useInlineChatDraft } from "@/context/InlineChatLayout";

type InlineChat = ReturnType<typeof useInlineChat>;

/** The chat's own controls: model, export, reset, and close. */
function InlineChatHeader({
	chat,
	onModelOpen,
}: {
	chat: InlineChat;
	onModelOpen: () => void;
}) {
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const {
		modelPresentation: { icon: ModelIcon },
	} = useSelectedModel();
	const { closeChat, getTranscriptContent, resetChat } = chat;
	const isBusy = !chat.conversationStarted || chat.isWaiting;

	return (
		<div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-4 py-2.5 dark:border-white/[0.08]">
			<span className="text-sm font-semibold text-black/70 dark:text-white/70">
				{t("askAI")}
			</span>
			<div className="flex items-center gap-1">
				<Button
					isIconOnly
					size="sm"
					variant="transparent"
					aria-label={t("change")}
					className="h-7 w-7 min-w-0 rounded-lg"
					onPress={onModelOpen}
				>
					<ModelIcon className="size-5 shrink-0 rounded-full bg-accent text-white [&:not([fill=none])]:fill-current p-1" />
				</Button>
				<AIGeneratedContentControls
					getContent={getTranscriptContent}
					downloadName="chat-transcript"
					isDisabled={isBusy}
					appearance="header"
				/>
				<Tooltip content={tUI("resetChat")} className="lg:hidden">
					<Button
						size="sm"
						variant="transparent"
						aria-label={tUI("resetChat")}
						startContent={<HugeiconsIcon icon={ReloadIcon} className="size-3.5" />}
						// Icon only where the header is tight; the words come
						// back on a wider screen.
						className="h-7 w-7 min-w-0 gap-1 rounded-lg px-0 text-xs text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10 lg:w-auto lg:px-2"
						isDisabled={isBusy}
						onPress={resetChat}
					>
						<span className="hidden lg:inline">
							{tUI("resetChat")}
						</span>
					</Button>
				</Tooltip>
				<Tooltip
					content={
						<ShortcutHint
							label={tUI("close")}
							keys={[SHORTCUT_KEYS.escape]}
						/>
					}
				>
					<Button
						isIconOnly
						size="sm"
						variant="transparent"
						aria-label={tUI("closePopupAriaLabel")}
						aria-keyshortcuts="Escape"
						className="h-7 w-7 min-w-0 rounded-lg text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
						onPress={closeChat}
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-4" />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}

/** The conversation, with the message box floating over its bottom edge. */
function InlineChatMessages({
	chat,
	modelId,
}: {
	chat: InlineChat;
	modelId: AIModelId;
}) {
	const t = useTranslations("ai");
	const {
		chatFailure,
		composerDockHeight,
		contentRef,
		error,
		isAtBottom,
		isLoading,
		isWaitingForAssistant,
		messages,
		messagesScrollRef,
		cited,
		pdfSources,
		reload,
		resetChat,
		scrollEdges,
		scrollToBottom,
	} = chat;
	const lastIndex = messages.length - 1;
	const asked = publicationsAsked(messages);

	return (
		<>
			<div
				ref={messagesScrollRef}
				className="h-full overflow-y-auto overflow-x-hidden"
			>
				<div
					ref={contentRef}
					className="flex min-h-full flex-col gap-6 px-4 pt-5"
					style={{ paddingBottom: composerDockHeight + 20 }}
				>
					<CitedPublications value={cited}>
						{messages.slice(1).map((message, index) => (
							<div
								key={message.id}
								className={twMerge(
									"flex w-full items-start gap-2",
									message.role === "user" && "justify-end",
								)}
							>
								<MessageComponent
									message={message}
									askedAbout={asked.get(message.id)}
									modelId={modelId}
									error={Boolean(error)}
									pdfSources={pdfSources}
									isStreaming={
										isLoading && index + 1 === lastIndex
									}
								/>
							</div>
						))}
					</CitedPublications>
					{isWaitingForAssistant ? (
						<div className="flex items-center gap-3 p-2">
							<div className="flex w-fit items-center justify-center rounded-full bg-black p-2 opacity-60">
								<HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin text-white" />
							</div>
						</div>
					) : null}
					{chatFailure.hasFailed ? (
						<ChatErrorCard
							message={chatFailure.message}
							isContextTooLarge={chatFailure.isContextTooLarge}
							onReset={resetChat}
							onRetry={reload}
						/>
					) : null}
				</div>
			</div>
			<div
				aria-hidden
				className={twMerge(
					"pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-white via-white/75 to-transparent transition-opacity duration-300 ease-out dark:from-card dark:via-card/75",
					scrollEdges.top ? "opacity-100" : "opacity-0",
				)}
			/>
			<div
				aria-hidden
				style={{ bottom: composerDockHeight }}
				className={twMerge(
					"pointer-events-none absolute inset-x-0 z-10 h-12 bg-gradient-to-t from-white via-white/75 to-transparent transition-opacity duration-300 ease-out dark:from-card dark:via-card/75",
					scrollEdges.bottom ? "opacity-100" : "opacity-0",
				)}
			/>
			<AnimatePresence>
				{isAtBottom ? null : (
					<motion.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 8 }}
						style={{ bottom: composerDockHeight + 12 }}
						className="absolute left-1/2 z-10 -translate-x-1/2"
					>
						<Button
							isIconOnly
							size="sm"
							className="rounded-full shadow-md"
							aria-label={t("jumpToLatest")}
							onPress={() => void scrollToBottom()}
						>
							<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}

/** The message box, docked to the bottom of the conversation. */
function InlineChatComposer({
	chat,
	onScreeningSettings,
}: {
	chat: InlineChat;
	onScreeningSettings: () => void;
}) {
	const t = useTranslations("ai");
	const {
		ask,
		canRunScreening,
		composerDockRef,
		composerFormRef,
		handleScreening,
		isComposerFocused,
		isDeepResearchEnabled,
		isMutating,
		isWaiting,
		mode,
		prefersReducedMotion,
		resizeComposer,
		screenableContent,
		screeningTooltip,
		setIsComposerFocused,
		setMode,
	} = chat;
	// The draft is read here, so typing redraws the message box on its own
	// rather than the conversation and the sources beside it.
	const { handleSubmit, input, isInputReady, setInput } =
		useInlineChatComposer({ ask, isWaiting, resizeComposer });
	const { attached, setAttached } = useInlineChatDraft();
	const isLit = isComposerFocused || isWaiting;

	return (
		<div
			ref={composerDockRef}
			className="absolute inset-x-0 bottom-0 z-20 border-t border-black/[0.05] bg-white p-3 dark:border-white/[0.08] dark:bg-card"
		>
			<AnimatePresence>
				{chat.isWaiting ? (
					<motion.div
						aria-hidden="true"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{
							duration: prefersReducedMotion ? 0 : 0.2,
						}}
						className="pointer-events-none absolute inset-x-6 top-0 z-20 h-px overflow-hidden"
					>
						<div className="h-full w-full animate-gradient-x bg-gradient-to-r from-transparent via-accent/40 to-transparent bg-shimmer motion-reduce:animate-none motion-reduce:bg-accent/20" />
					</motion.div>
				) : null}
			</AnimatePresence>
			<ChatComposerShell
				className="rounded-2xl p-1.5 dark:bg-secondary"
				isComposerFocused={isComposerFocused}
				isWaiting={chat.isWaiting}
				prefersReducedMotion={prefersReducedMotion}
				setComposerFocused={setIsComposerFocused}
			>
				<motion.div
					aria-hidden="true"
					initial={false}
					animate={{
						opacity: isLit ? 1 : 0,
						scaleX: isLit ? 1 : 0.35,
					}}
					transition={{
						duration: prefersReducedMotion ? 0 : 0.24,
						ease: [0.22, 1, 0.36, 1],
					}}
					className="pointer-events-none absolute inset-x-8 top-0 h-px origin-center bg-gradient-to-r from-transparent via-accent to-transparent"
				/>
				<AttachedRow item={attached} onRemove={() => setAttached(null)} onHeightChange={resizeComposer} />
				<form ref={composerFormRef} onSubmit={handleSubmit}>
					{/*
					 * A plain field on purpose: the one NextUI ships grows to
					 * several rows on focus in Firefox. The shell around it
					 * supplies the look; the height is worked out by hand.
					 */}
					<textarea
						rows={1}
						onKeyDown={(event) => {
							if (
								event.key !== "Enter" ||
								event.shiftKey ||
								event.nativeEvent.isComposing
							) {
								return;
							}
							event.preventDefault();
							handleSubmit(event);
						}}
						autoComplete="off"
						aria-label={t("askAI")}
						placeholder={t(attached ? "askMeAnything" : "askMeAnythingPublications")}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						className="block max-h-36 w-full min-w-0 resize-none overflow-y-auto bg-transparent px-2 py-2 text-base leading-6 md:[@media(pointer:fine)]:text-sm text-black outline-none placeholder:text-black/40 dark:text-white dark:placeholder:text-white/40"
					/>
					<ChatComposerControls
						compact
						canScreen={canRunScreening}
						isDeepResearchEnabled={isDeepResearchEnabled}
						isInputReady={isInputReady}
						isScreening={isMutating}
						isWaiting={chat.isWaiting}
						mode={mode}
						onModeChange={setMode}
						onScreen={() => void handleScreening(screenableContent)}
						onScreeningSettings={onScreeningSettings}
						prefersReducedMotion={prefersReducedMotion}
						screeningTooltip={screeningTooltip}
					/>
				</form>
			</ChatComposerShell>
		</div>
	);
}

/**
 * The assistant beside the search results: the conversation on one side, the
 * publications it has used on the other.
 */
export default function InlineLibraryChat({
	modelId,
	searchContext,
}: {
	modelId: AIModelId;
	/** Active library filters and sorting for the assistant's search tools. */
	searchContext?: LibrarySearchContext;
}) {
	const t = useTranslations("ai");
	const chat = useInlineChat({ modelId, searchContext });
	const { selectedModelId, setSelectedModelId } = useSelectedModel();
	const { theme } = useLibraryConfig();
	const {
		isOpen: isModelOpen,
		onOpen: onModelOpen,
		onOpenChange: onModelOpenChange,
	} = useDisclosure();

	return (
		<>
			<section
				// The column's width is animated by the grid around it. Its
				// height is the screen minus the headers above it.
				className={twMerge(
					"relative flex h-chat-column flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/10 dark:bg-card lg:h-chat-column-lg lg:min-h-chat-column",
					theme.layout === "small"
						? "xl:h-chat-column-small"
						: "xl:h-chat-column-small-xl",
				)}
				aria-label={t("askAI")}
			>
				{chat.isSmartScreeningOpen ? (
					<SmartScreeningModal
						isOpen
						onOpenChange={chat.onSmartScreeningOpenChange}
					/>
				) : null}
				<ModelSelector
					isOpen={isModelOpen}
					onOpenChange={onModelOpenChange}
					selectedModelId={selectedModelId}
					onModelChange={setSelectedModelId}
					hasConversation={chat.conversationStarted}
					onResetConversation={chat.resetChat}
				/>
				<ScreeningLimitConfirmation
					selection={chat.pendingScreening}
					onCancel={chat.cancelPendingScreening}
					onConfirm={chat.confirmPendingScreening}
				/>
				<InlineChatHeader chat={chat} onModelOpen={onModelOpen} />
				<div className="relative min-h-0 flex-1">
					<InlineChatMessages chat={chat} modelId={modelId} />
					<InlineChatComposer
						chat={chat}
						onScreeningSettings={chat.onSmartScreeningOpen}
					/>
				</div>
			</section>
		</>
	);
}
