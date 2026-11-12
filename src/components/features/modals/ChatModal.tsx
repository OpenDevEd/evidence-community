"use client";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { publicationsAsked } from "@/lib/ai/request-context";

import { ModalBody, ModalContent, useDisclosure } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import React, { type ComponentType } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon, Cancel01Icon, ReloadIcon } from "@hugeicons/core-free-icons";
import { twMerge } from "@/lib/tw-merge";

import { PoweredByOpenScholar } from "@/components/features/ai/PoweredByOpenScholar";
import ModelSelector from "@/components/features/ai/ModelSelector";
import { ScreeningLimitConfirmation } from "@/components/features/ai/ScreeningLimitConfirmation";
import { SmartScreeningModal } from "@/components/features/ai/SmartScreeningModal";
import { Logo } from "@/components/layout/navbar/Logo";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Textarea } from "@/components/nextui/Textarea";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import { createTextMessage } from "@/lib/ai/chat-messages";
import type { AIModelId } from "@/lib/ai/models";
import type { LibrarySearchContext } from "@/lib/search-context";
import { getAIModelPresentation } from "@/constants/ai";
import {
	ChatComposerControls,
	ChatComposerShell,
} from "../ai/ChatComposerControls";
import { ChatErrorCard } from "../ai/chat-shared";
import { useChatFailure } from "../ai/useChatActions";
import { MessageComponent } from "../ai/ChatMessage";
import { CitedPublications } from "../markdown/Citation";
import { useChatWindow } from "../ai/useChatWindow";
import type { AttachedItem } from "../ai/AskAbout";
import { AttachedRow } from "../ai/AttachedRow";
import { useStarterQuestions } from "../ai/useStarterQuestions";
import {
	AIGeneratedContentControls,
	type ControlAction,
	type GeneratedContent,
} from "./AIControls";

type ChatWindowState = ReturnType<typeof useChatWindow>;

/** What the page around the window can ask it to do. */
export type ChatWindowHandle = {
	/** Answers whether the question was taken. */
	ask: (question: string) => boolean;
};

type Message = ResearchUIMessage;
type ChatMessageListProps = {
	chatFailure: ReturnType<typeof useChatFailure>;
	contentRef: (element: HTMLDivElement | null) => void;
	hasError: boolean;
	isAtBottom: boolean;
	isStreaming: boolean;
	messages: Message[];
	modelId: AIModelId;
	onReset: () => void;
	onRetry: () => void;
	pdfSources: Record<string, string>;
	scrollEdges: { top: boolean; bottom: boolean };
	scrollRef: (element: HTMLDivElement | null) => void;
	scrollToBottom: () => void;
};

/** One message, sliding in from the side that sent it. */
function ChatMessageRow({
	askedAbout,
	hasError,
	isStreaming,
	message,
	modelId,
	pdfSources,
}: {
	askedAbout?: { key: string; title: string };
	hasError: boolean;
	isStreaming: boolean;
	message: Message;
	modelId: AIModelId;
	pdfSources: Record<string, string>;
}) {
	const fromReader = message.role === "user";

	return (
		<motion.div
			initial={{ x: fromReader ? 100 : -100, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			transition={{ type: "spring", stiffness: 260, damping: 20 }}
			className={twMerge(
				"flex items-start justify-start gap-2 w-full",
				fromReader && "flex-row-reverse",
			)}
		>
			<MessageComponent
				message={message}
				modelId={modelId}
				error={hasError}
				pdfSources={pdfSources}
				isStreaming={isStreaming}
				askedAbout={askedAbout}
			/>
		</motion.div>
	);
}

/** An empty reply bubble, shown while the assistant is still thinking. */
function PendingReply({
	modelId,
	pdfSources,
}: {
	modelId: AIModelId;
	pdfSources: Record<string, string>;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, x: -40 }}
			animate={{ opacity: 1, x: 0 }}
			className="flex w-full items-start justify-start gap-2"
		>
			<MessageComponent
				message={createTextMessage(
					"assistant",
					"",
					"pending-assistant",
				)}
				modelId={modelId}
				error={false}
				pdfSources={pdfSources}
				isStreaming={false}
			/>
		</motion.div>
	);
}

/** Fades the conversation out where it runs past the top or bottom edge. */
function ScrollEdgeFade({
	atTop,
	isVisible,
}: {
	atTop?: boolean;
	isVisible: boolean;
}) {
	return (
		<div
			aria-hidden
			className={twMerge(
				"pointer-events-none absolute inset-x-0 z-10 bg-gradient-to-b from-background_light via-background_light/75 to-transparent transition-opacity duration-300 ease-out dark:from-card dark:via-card/75",
				atTop ? "top-0 h-28" : "bottom-0 h-20 rotate-180",
				isVisible ? "opacity-100" : "opacity-0",
			)}
		/>
	);
}

/** The conversation itself, with its scroll behaviour and failure alert. */
function ChatMessageList({
	chatFailure,
	contentRef,
	hasError,
	isAtBottom,
	isStreaming,
	messages,
	modelId,
	onReset,
	onRetry,
	pdfSources,
	scrollEdges,
	scrollRef,
	scrollToBottom,
}: ChatMessageListProps) {
	const t = useTranslations("ai");
	const lastIndex = messages.length - 1;
	const asked = publicationsAsked(messages);
	const isWaitingForReply = isStreaming && messages.at(-1)?.role === "user";

	return (
		<motion.div
			layoutId="chat-messages"
			layout="position"
			transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
			className="relative h-full min-h-0 min-w-0 w-full overflow-hidden"
		>
			<div
				ref={scrollRef}
				className="h-full w-full overflow-y-auto overflow-x-hidden"
			>
				<div
					ref={contentRef}
					className="mx-auto flex min-h-full max-w-chat flex-col gap-8 px-4 pb-8 pt-28 lg:px-24"
				>
					{/* The greeting is the window's own text, not part of
					    the conversation, so it is drawn elsewhere. */}
					{messages.slice(1).map((message, index) => (
						<ChatMessageRow
							key={message.id}
							askedAbout={asked.get(message.id)}
							hasError={hasError}
							isStreaming={
								isStreaming &&
								index + 1 === lastIndex &&
								message.role === "assistant"
							}
							message={message}
							modelId={modelId}
							pdfSources={pdfSources}
						/>
					))}
					{isWaitingForReply ? (
						<PendingReply
							modelId={modelId}
							pdfSources={pdfSources}
						/>
					) : null}
					{chatFailure.hasFailed ? (
						<motion.div
							initial={{ opacity: 0, y: 16, scale: 0.97 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: 16, scale: 0.97 }}
							transition={{
								type: "spring",
								bounce: 0.3,
								duration: 0.5,
							}}
							className="flex w-full justify-center px-4"
						>
							<ChatErrorCard
								message={chatFailure.message}
								isContextTooLarge={
									chatFailure.isContextTooLarge
								}
								onReset={onReset}
								onRetry={onRetry}
								className="max-w-xl"
							/>
						</motion.div>
					) : null}
				</div>
			</div>
			<ScrollEdgeFade atTop isVisible={scrollEdges.top} />
			<ScrollEdgeFade isVisible={scrollEdges.bottom} />
			{isAtBottom ? null : (
				<Button
					isIconOnly
					size="sm"
					className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
					aria-label={t("jumpToLatest")}
					onPress={() => scrollToBottom()}
				>
					<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
				</Button>
			)}
		</motion.div>
	);
}

type ChatWindowComposerProps = {
	chat: ChatWindowState;
	hasPublication: boolean;
	onHeightChange: () => void;
	onScreen: () => void;
	questions?: string[];
};

/** The suggested questions shown before the conversation starts. */
function StarterQuestions({
	onPick,
	questions,
	ref,
}: {
	onPick: (question: string) => void;
	questions: string[];
	ref?: React.Ref<HTMLUListElement>;
}) {
	return (
		<motion.ul
			ref={ref}
			initial={{ opacity: 0, y: 100 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -100 }}
			className="w-full min-h-0 overflow-y-auto flex flex-col lg:flex-row gap-4 max-w-chat lg:px-14 mx-auto"
		>
			{questions.map((question) => (
				<li key={question}>
					<Button
						className="text-wrap p-4 bg-transparent dark:bg-transparent min-h-fit h-full"
						size="sm"
						onClick={() => {
							onPick(question);
						}}
					>
						{question}
					</Button>
				</li>
			))}
		</motion.ul>
	);
}

/** The message box itself. Enter sends, Shift+Enter starts a new line. */
function ChatMessageBox({
	hasPublication,
	input,
	onHeightChange,
	onSubmit,
	setInput,
}: {
	hasPublication: boolean;
	input: string;
	onHeightChange: () => void;
	onSubmit: (event: React.FormEvent) => void;
	setInput: (input: string) => void;
}) {
	const t = useTranslations("ai");
	const sendsOnEnter = (event: React.KeyboardEvent) =>
		event.key === "Enter" &&
		!event.shiftKey &&
		!(event.nativeEvent as KeyboardEvent).isComposing;

	return (
		<Textarea
			minRows={1}
			// The composer resizes the message viewport above it; re-pin
			// through the hook so it isn't mistaken for the user scrolling up.
			onHeightChange={onHeightChange}
			onKeyDown={(event) => {
				if (!sendsOnEnter(event)) return;
				event.preventDefault();
				onSubmit(event);
			}}
			// On a phone the keyboard would cover half the window as it opens, so the reader taps the box first. Only drawn once the window opens, in the browser.
			autoFocus={matchMedia("(hover: hover) and (pointer: fine)").matches}
			autoComplete="off"
			aria-label={t("askAI")}
			placeholder={t(
				hasPublication ? "askMeAnything" : "askMeAnythingPublications",
			)}
			value={input}
			onValueChange={setInput}
			classNames={{
				base: "w-full min-w-0",
				inputWrapper:
					"min-h-14 !rounded-2xl !border-0 !bg-transparent !px-2 !py-1 !shadow-none group-data-[focus=true]:!bg-transparent group-data-[hover=true]:!bg-transparent data-[focus=true]:!outline-none dark:!bg-transparent",
				// A quarter of the visible height at most (NextUI sets the variable on the wrapper), so above a keyboard the box never pushes Send out of view.
				input: "text-base leading-6 max-h-[calc(var(--visual-viewport-height)/4)]",
			}}
		/>
	);
}

/** The hairline that lights up while the composer is in use. */
function ComposerHairline({
	isLit,
	prefersReducedMotion,
}: {
	isLit: boolean;
	prefersReducedMotion: boolean | null;
}) {
	return (
		<motion.div
			aria-hidden="true"
			initial={false}
			animate={{ opacity: isLit ? 1 : 0, scaleX: isLit ? 1 : 0.35 }}
			transition={{
				duration: prefersReducedMotion ? 0 : 0.24,
				ease: [0.22, 1, 0.36, 1],
			}}
			className="pointer-events-none absolute inset-x-8 top-0 h-px origin-center bg-gradient-to-r from-transparent via-accent to-transparent"
		/>
	);
}

/** Starter questions, the message box, and the controls under it. */
function ChatWindowComposer({
	chat,
	hasPublication,
	onHeightChange,
	onScreen,
	questions,
}: ChatWindowComposerProps) {
	const {
		canRunScreening,
		conversationStarted,
		handleSubmit,
		input,
		isComposerFocused,
		isDeepResearchEnabled,
		isInputReady,
		isMutating,
		isWaiting,
		mode,
		onSmartScreeningOpen,
		prefersReducedMotion,
		screeningTooltip,
		setInput,
		setIsComposerFocused,
		setMode,
	} = chat;
	const showQuestions = !isWaiting && !conversationStarted;

	return (
		<form
			className="relative flex min-h-0 min-w-0 w-full flex-col gap-4 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] sm:gap-8 sm:p-8"
			onSubmit={handleSubmit}
		>
			<AnimatePresence mode="popLayout">
				{showQuestions && questions ? (
					<StarterQuestions
						key="questions"
						onPick={setInput}
						questions={questions}
					/>
				) : null}
				<ChatComposerShell
					key="composer"
					className="mx-auto max-w-3xl shrink-0 rounded-3xl p-2 dark:bg-card"
					isComposerFocused={isComposerFocused}
					isWaiting={isWaiting}
					prefersReducedMotion={prefersReducedMotion}
					setComposerFocused={setIsComposerFocused}
				>
					<ComposerHairline
						isLit={isComposerFocused || isWaiting}
						prefersReducedMotion={prefersReducedMotion}
					/>
					<AttachedRow
						item={chat.attached}
						onRemove={() => chat.setAttached(null)}
						onHeightChange={onHeightChange}
					/>
					<ChatMessageBox
						hasPublication={hasPublication}
						input={input}
						onHeightChange={onHeightChange}
						onSubmit={handleSubmit}
						setInput={setInput}
					/>
					<ChatComposerControls
						canScreen={canRunScreening}
						isDeepResearchEnabled={isDeepResearchEnabled}
						isInputReady={isInputReady}
						isScreening={isMutating}
						isWaiting={isWaiting}
						mode={mode}
						onModeChange={setMode}
						onScreen={onScreen}
						onScreeningSettings={onSmartScreeningOpen}
						prefersReducedMotion={prefersReducedMotion}
						screeningTooltip={screeningTooltip}
					/>
				</ChatComposerShell>
			</AnimatePresence>
		</form>
	);
}

/** The window's own controls: reset, export, and close. */
function ChatWindowTopBar({
	conversationStarted,
	getTranscriptContent,
	isWaiting,
	ModelIcon,
	onClose,
	onModelOpen,
	onReset,
}: {
	conversationStarted: boolean;
	getTranscriptContent: (action: ControlAction) => Promise<GeneratedContent>;
	isWaiting: boolean;
	ModelIcon: ComponentType<{ className?: string }>;
	onClose: () => void;
	onModelOpen: () => void;
	onReset: () => void;
}) {
	const tAI = useTranslations("ai");
	const tUI = useTranslations("ui");

	return (
		<>
			{/* Institution branding: the navbar's logo, including its home
			    link. Openscholar is credited under the composer. */}
			<div className="pointer-events-none absolute left-4 top-4 z-30 flex h-12 items-center sm:left-6 sm:top-5 [&_img]:max-h-10 [&_img]:w-auto">
				<div className="pointer-events-auto">
					<Logo />
				</div>
			</div>
			<div className="pointer-events-none absolute right-4 top-4 z-30 flex items-center gap-2 sm:right-6 sm:top-5">
				<div className="pointer-events-auto flex h-10 items-center gap-0.5 rounded-full border border-black/[0.08] bg-white p-1 shadow-card-flat dark:border-white/10 dark:bg-secondary-400 dark:shadow-none">
					<Button
						isIconOnly
						size="sm"
						variant="transparent"
						aria-label={tAI("change")}
						className="h-8 w-8 min-w-0 rounded-2xl"
						onPress={onModelOpen}
					>
						<ModelIcon className="size-5 shrink-0 rounded-full bg-accent text-white [&:not([fill=none])]:fill-current p-1" />
					</Button>
					<Button
						startContent={<HugeiconsIcon icon={ReloadIcon} />}
						variant="transparent"
						size="sm"
						className="h-8 min-w-0 gap-1.5 rounded-2xl px-2.5 text-sm text-black/60 hover:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.06] data-[disabled=true]:bg-transparent"
						aria-label={tUI("resetAriaLabel")}
						isDisabled={isWaiting}
						onClick={onReset}
					>
						<span className="hidden lg:block">
							{tUI("resetChat")}
						</span>
					</Button>
					<AIGeneratedContentControls
						getContent={getTranscriptContent}
						downloadName="chat-transcript"
						isDisabled={!conversationStarted || isWaiting}
						appearance="header"
					/>
				</div>
				<Button
					onPress={onClose}
					isIconOnly
					variant="transparent"
					className="pointer-events-auto size-10 rounded-full border border-black/[0.08] bg-white text-black/55 shadow-card-flat hover:bg-black/[0.035] hover:text-black/75 dark:border-white/10 dark:bg-secondary-400 dark:text-white/55 dark:shadow-none dark:hover:bg-white/[0.06] dark:hover:text-white/75"
					aria-label={tUI("closePopupAriaLabel")}
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-4" />
				</Button>
			</div>
		</>
	);
}

type ChatModalProps = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** The publication the next question is about, held by whoever opened the window, who also hears when the reader removes it. */
	publication?: AttachedItem | null;
	onPublicationChange?: (item: AttachedItem | null) => void;
	modelId: AIModelId;
	/** Lets the page ask a question when it opens the window. */
	ref?: React.Ref<ChatWindowHandle>;
	searchContext?: LibrarySearchContext;
	onModelChange?: (modelId: string) => void;
	onConversationStateChange?: (hasConversation: boolean) => void;
};

export default function ChatModal(
	props: Omit<ChatModalProps, "modelId"> & { modelId: AIModelId | null },
) {
	return props.modelId ? (
		<ChatModalContent {...props} modelId={props.modelId} />
	) : null;
}

function ChatModalContent({
	isOpen,
	onOpenChange,
	publication,
	onPublicationChange,
	modelId,
	ref,
	searchContext,
	onModelChange,
	onConversationStateChange,
}: ChatModalProps) {
	const {
		isOpen: isModelOpen,
		onOpen: onModelOpen,
		onOpenChange: onModelOpenChange,
	} = useDisclosure();
	const { ai } = useLibraryConfig();
	const modelPresentation = getAIModelPresentation(modelId, ai.providers);
	const chat = useChatWindow({
		publication,
		onPublicationChange,
		modelId,
		onConversationStateChange,
		searchContext,
	});
	const { ask } = chat;
	const questions = useStarterQuestions(chat.attached, isOpen && !chat.conversationStarted);
	React.useImperativeHandle(ref, () => ({ ask }), [ask]);
	const {
		canRunScreening,
		chatFailure,
		contentRef,
		conversationStarted,
		error,
		getTranscriptContent,
		handleScreening,
		handleSubmit,
		input,
		isAtBottom,
		isComposerFocused,
		isDeepResearchEnabled,
		isInputReady,
		isMutating,
		isSmartScreeningOpen,
		isWaiting,
		messages,
		messagesScrollRef,
		mode,
		onSmartScreeningOpen,
		onSmartScreeningOpenChange,
		pdfSources,
		prefersReducedMotion,
		cited,
		reload,
		resetChat,
		screenableContent,
		screeningTooltip,
		scrollEdges,
		scrollToBottom,
		setInput,
		setIsComposerFocused,
		setMode,
		status,
	} = chat;

	return (
		<>
			<ModelSelector
				isOpen={isModelOpen}
				onOpenChange={onModelOpenChange}
				selectedModelId={modelId}
				onModelChange={(nextModelId) => onModelChange?.(nextModelId)}
				hasConversation={conversationStarted}
				onResetConversation={resetChat}
			/>
			<ScreeningLimitConfirmation
				selection={chat.pendingScreening}
				onCancel={chat.cancelPendingScreening}
				onConfirm={chat.confirmPendingScreening}
			/>
			{isSmartScreeningOpen && (
				<SmartScreeningModal
					isOpen
					onOpenChange={onSmartScreeningOpenChange}
				/>
			)}
			<DialogModal
				size="full"
				scrollBehavior="inside"
				hideCloseButton
				isDismissable={false}
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				classNames={{
					// The wrapper is as tall as the part of the screen a phone's keyboard leaves visible; the window fills it, so the box stays above the keyboard.
					base: "m-0 h-full min-h-0 max-h-full w-screen max-w-none rounded-none border-none dark:border-none",
					wrapper: "overflow-hidden p-0",
				}}
			>
				<ModalContent className="relative h-full min-h-0 overflow-hidden">
					{(onClose) => (
						<>
							{/* Institution branding: the navbar's logo, including its
							    home link. Openscholar is credited under the composer. */}
							<ChatWindowTopBar
								conversationStarted={conversationStarted}
								getTranscriptContent={getTranscriptContent}
								isWaiting={isWaiting}
								ModelIcon={modelPresentation.icon}
								onClose={onClose}
								onModelOpen={onModelOpen}
								onReset={resetChat}
							/>
							<ModalBody className="min-h-0 w-full overflow-hidden p-0">
								<div
									className={twMerge(
										"relative h-full min-h-0 min-w-0 w-full",
										conversationStarted
											? "grid grid-rows-chat"
											// Below the top bar on a phone or a short screen; when the questions and the box don't fit, as above a keyboard, the questions scroll and the box stays.
											: "flex flex-col items-center justify-center pt-16 sm:[@media(min-height:40rem)]:pt-0",
									)}
								>
									{conversationStarted && (
										<CitedPublications value={cited}>
											<ChatMessageList
												chatFailure={chatFailure}
												contentRef={contentRef}
												isAtBottom={isAtBottom}
												isStreaming={status === "streaming"}
												hasError={Boolean(error)}
												messages={messages}
												modelId={modelId}
												onReset={resetChat}
												onRetry={reload}
												pdfSources={pdfSources}
												scrollEdges={scrollEdges}
												scrollRef={messagesScrollRef}
												scrollToBottom={scrollToBottom}
											/>
										</CitedPublications>
									)}
									<motion.div
										layoutId="chat-input"
										layout="position"
										transition={{
											type: "spring",
											bounce: 0.25,
											duration: 0.5,
										}}
										className="relative flex min-h-0 min-w-0 w-full flex-col items-center"
									>
										<AnimatePresence>
											{conversationStarted &&
												isWaiting && (
													<motion.div
														aria-hidden="true"
														initial={{ opacity: 0 }}
														animate={{ opacity: 1 }}
														exit={{ opacity: 0 }}
														transition={{
															duration:
																prefersReducedMotion
																	? 0
																	: 0.2,
														}}
														className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px overflow-hidden"
													>
														<div className="h-full w-full animate-gradient-x bg-gradient-to-r from-transparent via-accent/35 to-transparent bg-shimmer motion-reduce:animate-none motion-reduce:bg-accent/20" />
													</motion.div>
												)}
										</AnimatePresence>
										<ChatWindowComposer
											chat={chat}
											hasPublication={Boolean(chat.attached)}
											onHeightChange={() => {
												if (!isAtBottom) return;
												void scrollToBottom({
													animation: "instant",
												});
											}}
											onScreen={() =>
												void handleScreening(
													screenableContent,
												)
											}
											questions={questions}
										/>
										{/* Pulled up into the form's bottom padding; the form is
										    position:relative, so this needs its own stacking
										    context or the form swallows the clicks. */}
										<div className="relative z-10 -mt-1 flex w-full justify-center pb-3 sm:-mt-4 sm:pb-4">
											<PoweredByOpenScholar />
										</div>
									</motion.div>
								</div>
							</ModalBody>
						</>
					)}
				</ModalContent>
			</DialogModal>
		</>
	);
}
