"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ImSpinner8 } from "react-icons/im";
import { IoChevronDown } from "react-icons/io5";
import { LuX } from "react-icons/lu";
import {
	PiBinocularsBold,
	PiGearSixBold,
	PiPaperPlaneTiltFill,
	PiPlayFill,
} from "react-icons/pi";
import { RiResetLeftFill } from "react-icons/ri";
import { ButtonGroup, useDisclosure } from "@nextui-org/react";
import { useLocalStorage } from "usehooks-ts";
import ModelSelector from "@/components/features/ai/ModelSelector";
import { ConfirmationModal } from "@/components/nextui/ConfirmationModal";
import {
	MessageComponent,
	createTextMessage,
	type ChatMode,
	type Message,
} from "@/components/features/modals/ChatModal";
import {
	AIGeneratedContentControls,
	type ControlAction,
	type GeneratedContent,
} from "@/components/features/modals/AIControls";
import {
	SmartScreeningModal,
	useIsAISearchEnabled,
	type SmartScreeningField,
} from "@/components/pages/EvidenceLibrary";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { getAIModelForUI } from "@/constants/ai";
import {
	useInlineChatLayout,
	type BucketEntry,
} from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useFiltersContext } from "@/context/FiltersProvider";
import { clientAIError, uiMessageText } from "@/lib/ai/client";
import { AI_CONTEXT_TOO_LARGE_MESSAGE } from "@/lib/ai/error-message";
import type { AIModelId } from "@/lib/ai/models";
import {
	createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextPart,
	researchRequestContextsEqual,
} from "@/lib/ai/request-context";
import {
	CHAT_EXPORT_OUTPUT,
	chatTranscriptContent,
	type ChatTranscriptFormat,
} from "@/lib/ai/transcript-export";
import type { LibrarySearchContext } from "@/lib/search-context";
import { twMerge } from "tailwind-merge";
import { useStickToBottom } from "use-stick-to-bottom";
import { BucketSourcesLoader } from "./ContextBucket";
import { ChatErrorCard, ShortcutHint, useScrollEdges } from "./chat-shared";
import { SHORTCUT_KEYS } from "@/hooks/useShortcutHints";
import { style as siteStyle } from "@/../tailwind.config";
import { screeningSelection } from "@/lib/ai/screening-selection";

/**
 * Publications the model touched, most recently touched first. Search hits
 * enter the bucket where first seen; reading a publication bumps it to the
 * top, so the paper the model is currently working from always leads.
 */
// Publication links the model writes in its answers: `/lib/KEY`, optionally
// locale-prefixed, followed by a download path, query, or closing bracket.
const CITED_KEY_PATTERN = /\/lib\/([A-Za-z0-9]+)(?=[/?#)\s"'\]]|$)/g;

function bucketEntriesFromMessages(messages: Message[]): BucketEntry[] {
	const entries = new Map<string, BucketEntry["source"]>();
	for (const message of messages) {
		for (const part of message.parts) {
			// Anything the assistant cites counts as a source — this covers
			// answers built from a current-results listing (whose 200 entries
			// are deliberately not dumped into the bucket) and direct links.
			if (message.role === "assistant" && part.type === "text") {
				for (const match of part.text.matchAll(CITED_KEY_PATTERN)) {
					if (!entries.has(match[1])) entries.set(match[1], "search");
				}
				continue;
			}
			if (!isToolUIPart(part)) continue;
			if (part.type === "tool-readPublications") {
				const input = part.input as { itemKeys?: string[] } | undefined;
				for (const key of input?.itemKeys ?? []) {
					entries.delete(key);
					entries.set(key, "read");
				}
			}
			if (part.type === "tool-searchLibrary") {
				const output = part.output as
					| { queries?: Array<{ hits?: Array<{ key?: string }> }> }
					| undefined;
				for (const query of output?.queries ?? []) {
					for (const hit of query.hits ?? []) {
						if (hit.key && !entries.has(hit.key)) {
							entries.set(hit.key, "search");
						}
					}
				}
			}
		}
	}
	return Array.from(entries, ([key, source]) => ({ key, source })).reverse();
}

export default function InlineLibraryChat({
	modelId,
	searchContext,
}: {
	modelId: AIModelId;
	searchContext?: LibrarySearchContext;
}) {
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const locale = useLocale();
	const prefersReducedMotion = useReducedMotion();
	const {
		setEngaged,
		bucketEntries,
		setBucketEntries,
		pendingInput,
		setPendingInput,
		pendingSend,
		setPendingSend,
		requestSearchFocus,
		askedSearchRef,
		getChat,
		chatRequestRef,
		composerDraft,
		setComposerDraft,
		pdfSources,
	} = useInlineChatLayout();
	const filters = useFiltersContext();
	const {
		modelObject: { icon: ModelIcon },
		selectedModel,
		setSelectedModel,
	} = useSelectedModel();
	const {
		isOpen: isModelOpen,
		onOpen: onModelOpen,
		onOpenChange: onModelOpenChange,
	} = useDisclosure();
	const {
		isOpen: isSmartScreeningOpen,
		onOpen: onSmartScreeningOpen,
		onOpenChange: onSmartScreeningOpenChange,
	} = useDisclosure();
	const [smartScreeningFields] = useLocalStorage<SmartScreeningField[]>(
		"smart-screening-fields",
		[],
	);
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	const [internalMode, setMode] = useLocalStorage<ChatMode>(
		"chat-mode",
		"quick",
	);
	const mode: ChatMode = isDeepResearchEnabled ? internalMode : "quick";
	// Seed the composer with whatever was typed in the search bar before the
	// split layout took over (unless it is about to be auto-sent).
	const [input, setInput] = useState(() =>
		pendingSend ? "" : pendingInput || composerDraft,
	);
	// Keep the unsent draft across page visits (it is restored above).
	const inputRef = useRef(input);
	inputRef.current = input;
	useEffect(
		() => () => setComposerDraft(inputRef.current),
		[setComposerDraft],
	);
	const [isComposerFocused, setIsComposerFocused] = useState(false);
	const [isMutating, setIsMutating] = useState(false);
	// The composer form is the anchor for focusing/sizing the field.
	const composerFormRef = useRef<HTMLFormElement>(null);
	// Manual autosize: react-textarea-autosize (NextUI's default) mis-measures
	// on focus in Firefox, ballooning the empty field to several rows.
	// The composer is docked *over* the bottom of the message viewport (the
	// viewport itself never changes height), and the message content is
	// padded by the dock's height. Growing the composer therefore grows the
	// content — which the stick-to-bottom hook follows — and shrinking it is
	// a content shrink the hook already ignores; neither can be mistaken for
	// the user scrolling.
	const composerDockRef = useRef<HTMLDivElement>(null);
	const [composerDockHeight, setComposerDockHeight] = useState(0);
	// One wrinkle remains: when the dock *shrinks*, the content shrinks and
	// the browser clamps scrollTop, and depending on event ordering the hook
	// can end up "escaped" while sitting at the bottom — the next streamed
	// token then shows the chevron instead of being followed. So after a
	// shrink that happened while pinned, re-arm the lock explicitly through
	// the hook's own API once the clamp has been processed.
	const rearmStickToBottomRef = useRef<() => void>(() => {});
	const pinnedBeforeDockChangeRef = useRef(true);
	const rearmOnNextScrollRef = useRef(false);
	useLayoutEffect(() => {
		const dock = composerDockRef.current;
		if (!dock) return;
		let lastHeight = dock.offsetHeight;
		let fallback: ReturnType<typeof setTimeout> | undefined;
		setComposerDockHeight(lastHeight);
		const observer = new ResizeObserver(() => {
			const height = dock.offsetHeight;
			const shrank = height < lastHeight;
			lastHeight = height;
			setComposerDockHeight(height);
			if (shrank && pinnedBeforeDockChangeRef.current) {
				// The padding shrink lands in a later React commit, and the
				// browser's clamp scroll event (which is what un-pins the
				// hook) comes after that — so re-arm on that scroll event,
				// after the hook's own 1 ms handler. Fallback in case the
				// content is short enough that nothing clamps.
				rearmOnNextScrollRef.current = true;
				clearTimeout(fallback);
				fallback = setTimeout(() => {
					if (!rearmOnNextScrollRef.current) return;
					rearmOnNextScrollRef.current = false;
					rearmStickToBottomRef.current();
				}, 150);
			}
		});
		observer.observe(dock);
		return () => {
			clearTimeout(fallback);
			observer.disconnect();
		};
	}, []);
	const resizeComposer = useCallback(() => {
		const element = composerFormRef.current?.querySelector("textarea");
		if (!element) return;
		// Empty while the column is still animating open (near-zero width):
		// let rows={1} decide, because measuring would count the placeholder
		// wrapped over dozens of lines. Once the width has settled the
		// placeholder is measured like text, so on a phone where it wraps
		// to two lines the field grows to fit instead of clipping it.
		if (!element.value && element.clientWidth < 200) {
			element.style.height = "";
		} else {
			element.style.height = "0px";
			element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
		}
	}, []);

	// Close hands focus back to the library search field so Esc → type →
	// ⌘↵ round-trips without the mouse. The search Ask AI took comes back,
	// unless a new one was typed while the chat was open.
	const { queryParams, handleSearchChange } = filters;
	const closeChat = useCallback(() => {
		setEngaged(false);
		if (askedSearchRef.current && !queryParams.search) {
			handleSearchChange(askedSearchRef.current);
		}
		askedSearchRef.current = "";
		requestSearchFocus();
	}, [setEngaged, askedSearchRef, queryParams.search, handleSearchChange, requestSearchFocus]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (event.isComposing) return;
			// Open dialogs (model picker, screening settings) own Esc.
			if (document.querySelector('[role="dialog"]')) return;
			event.preventDefault();
			closeChat();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [closeChat]);

	const {
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		setMessages,
		clearError,
	} = useChat<Message>({
		throttle: 50,
		// The Chat instance is owned by the layout provider so the
		// conversation survives navigating away and back; the transport
		// reads the current request values through chatRequestRef.
		chat: getChat(
			modelId,
			() =>
				new Chat<Message>({
					transport: new DefaultChatTransport({
						api: "/api/ai/chat",
						headers: () => ({
							"Accept-Language":
								chatRequestRef.current?.locale ?? locale,
						}),
						body: () => ({
							modelId: chatRequestRef.current?.modelId ?? modelId,
							distinctId:
								getAnalyticsDistinctId() ?? undefined,
							mode: chatRequestRef.current?.mode ?? mode,
							searchContext:
								chatRequestRef.current?.searchContext,
						}),
					}),
					messages: [
						createTextMessage(
							"assistant",
							t("askMeAnythingPublications"),
							"start",
						),
					],
				}),
		),
	});
	chatRequestRef.current = { modelId, mode, locale, searchContext };

	const currentRequestContext = useCallback(
		() => createResearchRequestContextSnapshot({ searchContext }),
		[searchContext],
	);
	const sendMessageWithContext = useCallback(
		(text: string) => {
			const context = currentRequestContext();
			const parts: Message["parts"] = [];
			if (
				!researchRequestContextsEqual(
					latestResearchRequestContext(messages),
					context,
				)
			) {
				parts.push(researchRequestContextPart(context));
			}
			parts.push({ type: "text", text });
			return sendMessage({ parts });
		},
		[currentRequestContext, messages, sendMessage],
	);

	// Consume the pending text exactly once: when the user hit Ask AI with
	// text, send it straight away; either way move focus into the composer
	// with the caret where they left off.
	const consumedPendingRef = useRef(false);
	useEffect(() => {
		if (consumedPendingRef.current) return;
		consumedPendingRef.current = true;
		if (pendingSend && pendingInput.trim()) {
			void sendMessageWithContext(pendingInput.trim());
		}
		requestAnimationFrame(() => {
			const element = composerFormRef.current?.querySelector("textarea");
			if (!element) return;
			element.focus({ preventScroll: true });
			element.setSelectionRange(
				element.value.length,
				element.value.length,
			);
			resizeComposer();
		});
	}, []);
	// Keep the manual autosize in step with every value change (typing,
	// seeding, clearing after send).
	useLayoutEffect(() => {
		resizeComposer();
	}, [input, resizeComposer]);
	// The chat column animates open from ~0 width, so a measurement taken at
	// mount sees the placeholder wrapped over many lines and pins the field
	// at its cap. Re-measure whenever the field's width settles or changes.
	useEffect(() => {
		const element = composerFormRef.current?.querySelector("textarea");
		if (!element) return;
		let lastWidth = -1;
		let settle: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.contentRect.width ?? 0;
			if (width === lastWidth) return;
			lastWidth = width;
			// The column animates its width for ~450 ms; measuring on every
			// observer tick would force a synchronous layout per frame.
			// Wait for the width to stop changing, then measure once.
			clearTimeout(settle);
			settle = setTimeout(resizeComposer, 90);
		});
		observer.observe(element);
		return () => {
			clearTimeout(settle);
			observer.disconnect();
		};
	}, [resizeComposer]);
	useEffect(
		() => () => {
			setPendingInput("");
			setPendingSend(false);
		},
		[setPendingInput, setPendingSend],
	);

	const isLoading = status === "submitted" || status === "streaming";
	const isWaiting = (isLoading || isMutating) && !error;
	const isInputReady = input.trim().length > 0 && !isWaiting;
	const conversationStarted = messages.length > 1;

	useEffect(() => {
		setBucketEntries(bucketEntriesFromMessages(messages));
	}, [messages, setBucketEntries]);
	// The bucket mirrors the persisted conversation (provider-owned), so it
	// is re-derived on mount and never cleared on unmount.

	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useStickToBottom({ initial: "smooth", resize: "smooth" });
	// Tracked continuously so the dock observer knows whether the user was
	// pinned *before* the dock changed size.
	pinnedBeforeDockChangeRef.current = isAtBottom;
	rearmStickToBottomRef.current = () => {
		void scrollToBottom({ animation: "instant" });
	};

	const { edges: scrollEdges, ref: scrollEdgesRef } = useScrollEdges();
	const messagesScrollRef = useCallback(
		(element: HTMLDivElement | null) => {
			scrollRef(element);
			element?.addEventListener("scroll", () => {
				if (!rearmOnNextScrollRef.current) return;
				rearmOnNextScrollRef.current = false;
				setTimeout(() => rearmStickToBottomRef.current(), 10);
			});
			scrollEdgesRef(element);
		},
		[scrollRef, scrollEdgesRef],
	);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		// Ignore submits while a response is generating; the input keeps its
		// text so nothing is lost.
		if (isLoading || isMutating || !input.trim()) return;
		void sendMessageWithContext(input);
		setInput("");
	};

	const appendMessage = useCallback(
		(message: Message) => {
			setMessages((prevMessages) => [
				...prevMessages.filter(({ id }) => id !== message.id),
				message,
			]);
		},
		[setMessages],
	);

	const screenableContent = useMemo(
		() =>
			messages
				.filter(
					(message) =>
						message.role === "assistant" &&
						!message.id.startsWith("screening-"),
				)
				.map(uiMessageText)
				.filter((content) => content.includes("/lib/"))
				.join("\n"),
		[messages],
	);
	const canRunScreening =
		smartScreeningFields.length > 0 && screenableContent.length > 0;

	const [pendingScreening, setPendingScreening] =
		useState<ReturnType<typeof screeningSelection>>();
	const runScreening = async (keys: string[]) => {
		if (!keys.length || smartScreeningFields.length === 0) {
			return;
		}
		setIsMutating(true);
		try {
			const response = await fetch("/api/ai/screen", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					keys,
					modelId,
					fields: smartScreeningFields,
					distinctId: getAnalyticsDistinctId() ?? undefined,
				}),
			});
			if (!response.ok) throw new Error(await response.text());
			const result = await response.json();
			if (Object.keys(result).length > 0) {
				appendMessage(
					createTextMessage(
						"assistant",
						JSON.stringify({
							result: result,
							fields: smartScreeningFields,
						}),
						"screening-result",
					),
				);
			} else {
				appendMessage(
					createTextMessage(
						"assistant",
						tUI("noResourcesForScreening"),
						"screening-result",
					),
				);
			}
		} catch (screeningError) {
			console.error(screeningError);
			const visibleError = clientAIError(
				screeningError instanceof Error
					? screeningError
					: new Error(String(screeningError)),
			);
			appendMessage(
				createTextMessage(
					"assistant",
					visibleError.message,
					"screening-error",
				),
			);
		} finally {
			setIsMutating(false);
		}
	};
	const handleScreening = (content: string) => {
		const selection = screeningSelection(content);
		if (!selection.keys.length || smartScreeningFields.length === 0) return;
		if (selection.omitted > 0) {
			setPendingScreening(selection);
			return;
		}
		void runScreening(selection.keys);
	};

	const getTranscriptContent = useCallback(
		async (action: ControlAction): Promise<GeneratedContent> => {
			if (action === "csv") {
				throw new Error("CSV is not available for chat transcripts.");
			}

			const format = action satisfies ChatTranscriptFormat;
			const content = await chatTranscriptContent(
				format,
				messages.slice(1),
				{
					title: t("askAI"),
					user: tUI("genericUser"),
					assistant: getAIModelForUI(modelId).name,
					reasoning: t("reasoning"),
					smartScreening: tUI("smartScreening"),
				},
				window.location.origin,
			);
			return { content, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[messages, modelId, t, tUI],
	);

	const resetChat = useCallback(() => {
		clearError();
		setMessages((current) => current.slice(0, 1));
		setBucketEntries([]);
	}, [clearError, setMessages, setBucketEntries]);

	const reload = useCallback(() => regenerate(), [regenerate]);

	const visibleChatError = error ? clientAIError(error) : undefined;
	const isContextTooLarge =
		visibleChatError?.message === AI_CONTEXT_TOO_LARGE_MESSAGE;
	const visibleChatErrorMessage =
		visibleChatError &&
		(visibleChatError.message.includes("RATE_LIMITED") ||
			visibleChatError.message.includes("Rate limit exceeded"))
			? t("rateLimitedMessage", { seconds: 60 })
			: visibleChatError?.message || t("errorMessage");
	const isWaitingForAssistant = isLoading && messages.at(-1)?.role === "user";

	return (
		<section
			// Enter/exit fades live on the presence wrapper in ResourcesView;
			// the column width squeezes via the parent grid's CSS transition.
			// Height = viewport − header stack above − 1.5rem bottom margin.
			// xl stacks: wide 6.5rem, small 8.125rem (see ResourcesView).
			className={twMerge(
				"relative flex h-[calc(100dvh-14rem)] flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/10 dark:bg-card lg:h-[calc(100dvh-6.5rem)] lg:min-h-[28rem]",
				siteStyle === "small"
					? "xl:h-[calc(100dvh-9.625rem)]"
					: "xl:h-[calc(100dvh-8rem)]",
			)}
			aria-label={t("askAI")}
		>
			{bucketEntries.map((entry) => (
				<BucketSourcesLoader key={entry.key} itemKey={entry.key} />
			))}
			{isSmartScreeningOpen && (
				<SmartScreeningModal
					isOpen
					onOpenChange={onSmartScreeningOpenChange}
				/>
			)}
			<ConfirmationModal
				isOpen={pendingScreening !== undefined}
				onOpenChange={(open) => {
					if (!open) setPendingScreening(undefined);
				}}
				title={tUI("screeningLimitTitle", {
					count: pendingScreening?.keys.length ?? 0,
				})}
				description={tUI("screeningLimitDescription", {
					total: pendingScreening?.total ?? 0,
					count: pendingScreening?.keys.length ?? 0,
					omitted: pendingScreening?.omitted ?? 0,
				})}
				confirmLabel={tUI("screeningLimitConfirm", {
					count: pendingScreening?.keys.length ?? 0,
				})}
				cancelLabel={tUI("cancel")}
				onConfirm={() => {
					if (!pendingScreening) return;
					const { keys } = pendingScreening;
					setPendingScreening(undefined);
					void runScreening(keys);
				}}
			/>
			<ModelSelector
				isOpen={isModelOpen}
				onOpenChange={onModelOpenChange}
				selectedModel={selectedModel}
				onModelChange={setSelectedModel}
				hasConversation={conversationStarted}
			/>
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
						onClick={onModelOpen}
					>
						<ModelIcon className="size-5 shrink-0 rounded-full bg-accent fill-white p-1" />
					</Button>
					<AIGeneratedContentControls
						getContent={getTranscriptContent}
						downloadName="chat-transcript"
						isDisabled={!conversationStarted || isWaiting}
						appearance="header"
						analyticsContext="chat_transcript"
					/>
					<Tooltip content={tUI("resetChat")} className="lg:hidden">
						<Button
							size="sm"
							variant="transparent"
							aria-label={tUI("resetChat")}
							startContent={
								<RiResetLeftFill className="size-3.5" />
							}
							// Icon-only on mobile where the header is tight;
							// the label returns from lg.
							className="h-7 w-7 min-w-0 gap-1 rounded-lg px-0 text-xs text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10 lg:w-auto lg:px-2"
							isDisabled={!conversationStarted || isWaiting}
							onClick={resetChat}
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
							<LuX className="size-4" />
						</Button>
					</Tooltip>
				</div>
			</div>

			<div className="relative min-h-0 flex-1">
				<div
					ref={messagesScrollRef}
					className="no-scrollbar h-full overflow-y-auto overflow-x-hidden"
				>
					<div
						ref={contentRef}
						className="flex min-h-full flex-col gap-6 px-4 pt-5"
						style={{ paddingBottom: composerDockHeight + 20 }}
					>
						{messages.map(
							(message, index) =>
								index > 0 && (
									<div
										key={message.id}
										className={twMerge(
											"flex w-full items-start gap-2",
											message.role === "user" &&
												"justify-end",
										)}
									>
										<MessageComponent
											message={message}
											modelId={modelId}
											error={!!error}
											pdfSources={pdfSources}
											isStreaming={
												isLoading &&
												index === messages.length - 1
											}
										/>
									</div>
								),
						)}
						{isWaitingForAssistant && (
							<div className="flex items-center gap-3 p-2">
								<div className="flex w-fit items-center justify-center rounded-full bg-black p-2 opacity-60">
									<ImSpinner8 className="size-4 animate-spin text-white" />
								</div>
							</div>
						)}
						{visibleChatError && (
							<ChatErrorCard
								message={visibleChatErrorMessage}
								isContextTooLarge={isContextTooLarge}
								onReset={resetChat}
								onRetry={reload}
							/>
						)}
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
					{!isAtBottom && (
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
								aria-label={tUI("scrollToBottomAriaLabel")}
								onClick={() => void scrollToBottom()}
							>
								<IoChevronDown className="size-4" />
							</Button>
						</motion.div>
					)}
				</AnimatePresence>
				<div
					ref={composerDockRef}
					className="absolute inset-x-0 bottom-0 z-20 border-t border-black/[0.05] bg-white p-3 dark:border-white/[0.08] dark:bg-card"
				>
					<AnimatePresence>
						{isWaiting && (
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
								<div className="h-full w-full animate-gradient-x bg-gradient-to-r from-transparent via-accent/40 to-transparent bg-[length:200%_100%] motion-reduce:animate-none motion-reduce:bg-accent/20" />
							</motion.div>
						)}
					</AnimatePresence>
					<motion.div
						initial={false}
						animate={{
							y:
								isComposerFocused && !prefersReducedMotion
									? -2
									: 0,
							scale:
								isComposerFocused && !prefersReducedMotion
									? 1.004
									: 1,
						}}
						whileHover={
							prefersReducedMotion || isWaiting
								? undefined
								: { y: -1 }
						}
						transition={{
							type: "spring",
							stiffness: 360,
							damping: 28,
						}}
						onFocusCapture={() => setIsComposerFocused(true)}
						onBlurCapture={(event) => {
							if (
								!event.currentTarget.contains(
									event.relatedTarget,
								)
							) {
								setIsComposerFocused(false);
							}
						}}
						className="group/composer relative z-10 w-full min-w-0 overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-1.5 shadow-[0_12px_40px_-34px_rgba(0,0,0,0.45)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent/45 focus-within:shadow-[0_18px_48px_-32px_rgba(235,126,29,0.38)] dark:border-white/10 dark:bg-secondary dark:shadow-none dark:focus-within:shadow-[0_18px_48px_-32px_rgba(235,126,29,0.22)]"
					>
						<motion.div
							aria-hidden="true"
							initial={false}
							animate={{
								opacity: isComposerFocused || isWaiting ? 1 : 0,
								scaleX:
									isComposerFocused || isWaiting ? 1 : 0.35,
							}}
							transition={{
								duration: prefersReducedMotion ? 0 : 0.24,
								ease: [0.22, 1, 0.36, 1],
							}}
							className="pointer-events-none absolute inset-x-8 top-0 h-px origin-center bg-gradient-to-r from-transparent via-accent to-transparent"
						/>
						<form ref={composerFormRef} onSubmit={handleSubmit}>
							{/*
							 * Plain textarea on purpose: NextUI's Textarea
							 * (react-textarea-autosize) balloons on focus in
							 * Firefox. The composer shell provides the visual
							 * chrome; sizing is plain scrollHeight math.
							 */}
							<textarea
								rows={1}
								onKeyDown={(e) => {
									// Enter or ⌘/Ctrl+Enter sends (the latter
									// mirrors the Ask AI shortcut); Shift+Enter
									// inserts a newline.
									if (
										e.key === "Enter" &&
										!e.shiftKey &&
										!e.nativeEvent.isComposing
									) {
										e.preventDefault();
										handleSubmit(e);
									}
								}}
								autoComplete="off"
								aria-label={t("askAI")}
								placeholder={t("askMeAnythingPublications")}
								value={input}
								onChange={(e) => setInput(e.target.value)}
								className="block max-h-36 w-full min-w-0 resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm leading-6 text-black outline-none placeholder:text-black/40 dark:text-white dark:placeholder:text-white/40"
							/>
							<div className="mt-1 flex min-w-0 items-center justify-between gap-2 border-t border-black/[0.06] px-1 pt-1.5 dark:border-white/[0.08]">
								<div className="flex min-w-0 items-center gap-1">
									{isDeepResearchEnabled && (
										<Tooltip
											content={tUI("researchModeTooltip")}
										>
											<Button
												type="button"
												size="sm"
												variant="transparent"
												aria-pressed={
													mode === "research"
												}
												aria-label={tUI("researchMode")}
												onPress={() =>
													setMode(
														mode === "research"
															? "quick"
															: "research",
													)
												}
												className={twMerge(
													"h-8 min-w-8 gap-1.5 rounded-xl bg-black/[0.035] px-2 text-black/55 transition-colors hover:bg-black/[0.06] dark:bg-white/[0.05] dark:text-white/55 dark:hover:bg-white/[0.08]",
													mode === "research" &&
														"bg-accent/10 text-accent hover:bg-accent/15 dark:bg-accent/15 dark:text-accent",
												)}
											>
												<motion.span
													initial={false}
													animate={{
														scale:
															mode === "research"
																? 1.12
																: 1,
														rotate:
															mode === "research"
																? 0
																: -8,
													}}
													transition={{
														type: "spring",
														stiffness: 420,
														damping: 22,
													}}
													className="grid place-items-center"
												>
													<PiBinocularsBold className="size-4 shrink-0" />
												</motion.span>
												<span className="hidden whitespace-nowrap xl:inline">
													{tUI("researchMode")}
												</span>
											</Button>
										</Tooltip>
									)}
									<ButtonGroup className="shrink-0 overflow-hidden rounded-xl bg-black/[0.035] dark:bg-white/[0.05]">
										<Tooltip
											content={`${tUI("smartScreening")} ${tUI("settings")}`}
										>
											<Button
												type="button"
												size="sm"
												variant="transparent"
												className="h-8 min-w-8 gap-1.5 rounded-none border-0 px-2 text-black/55 transition-colors hover:bg-black/[0.05] dark:text-white/55 dark:hover:bg-white/[0.06]"
												isDisabled={isMutating}
												aria-label={`${tUI("smartScreening")} ${tUI("settings")}`}
												onPress={onSmartScreeningOpen}
											>
												<PiGearSixBold className="size-4 shrink-0 transition-transform duration-300 group-hover:rotate-45 motion-reduce:transition-none" />
												<span className="hidden whitespace-nowrap xl:inline">
													{tUI("smartScreening")}
												</span>
											</Button>
										</Tooltip>
										<Tooltip
											content={
												smartScreeningFields.length ===
												0
													? tUI("noFieldsAdded")
													: screenableContent.length ===
														  0
														? tUI(
																"noResourcesForScreening",
															)
														: tUI("smartScreening")
											}
										>
											<Button
												isIconOnly
												type="button"
												size="sm"
												variant="transparent"
												className="!h-8 !w-8 !min-w-8 shrink-0 rounded-none border-0 border-l border-black/[0.06] bg-accent/10 text-accent transition-colors hover:bg-accent/15 dark:border-white/[0.08] dark:bg-accent/15 dark:text-accent dark:hover:bg-accent/20"
												isDisabled={
													isLoading ||
													isMutating ||
													!canRunScreening
												}
												aria-label={tUI(
													"smartScreening",
												)}
												onPress={() =>
													handleScreening(
														screenableContent,
													)
												}
											>
												{isMutating ? (
													<ImSpinner8 className="size-3.5 animate-spin" />
												) : (
													<PiPlayFill className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
												)}
											</Button>
										</Tooltip>
									</ButtonGroup>
								</div>
								<motion.div
									whileHover={
										prefersReducedMotion || isWaiting
											? undefined
											: { scale: 1.07 }
									}
									whileTap={
										prefersReducedMotion || isWaiting
											? undefined
											: { scale: 0.9 }
									}
									className="shrink-0"
								>
									<Tooltip
										content={
											<span className="flex flex-col gap-1">
												<ShortcutHint
													label={tUI(
														"sendMessageAriaLabel",
													)}
													keys={[SHORTCUT_KEYS.enter]}
												/>
												<ShortcutHint
													label={tUI("newLine")}
													keys={[
														`${SHORTCUT_KEYS.shift} ${SHORTCUT_KEYS.enter}`,
													]}
												/>
											</span>
										}
									>
										<Button
											isDisabled={isWaiting}
											type="submit"
											isIconOnly
											color="accent"
											size="sm"
											className="group/send !h-8 !w-8 !min-w-8 shrink-0 rounded-xl border-0"
											aria-label={tUI(
												"sendMessageAriaLabel",
											)}
											aria-keyshortcuts="Enter"
										>
											<AnimatePresence
												mode="wait"
												initial={false}
											>
												<motion.span
													key={
														isWaiting
															? "waiting"
															: isInputReady
																? "ready"
																: "idle"
													}
													initial={
														prefersReducedMotion
															? false
															: {
																	opacity: 0,
																	scale: 0.72,
																	x: -2,
																	y: 2,
																}
													}
													animate={{
														opacity: 1,
														scale: 1,
														x: 0,
														y: 0,
													}}
													exit={{
														opacity: 0,
														scale: 0.72,
													}}
													transition={{
														type: "spring",
														stiffness: 520,
														damping: 30,
													}}
													className="grid place-items-center"
												>
													{isWaiting ? (
														<ImSpinner8 className="size-4 animate-spin" />
													) : (
														<PiPaperPlaneTiltFill className="size-4 transition-transform duration-200 group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5 motion-reduce:transition-none" />
													)}
												</motion.span>
											</AnimatePresence>
										</Button>
									</Tooltip>
								</motion.div>
							</div>
						</form>
					</motion.div>
				</div>
			</div>
		</section>
	);
}
