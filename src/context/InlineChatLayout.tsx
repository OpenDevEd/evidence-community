"use client";

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import { createTextMessage } from "@/lib/ai/chat-messages";
import { usePathname } from "@/i18n/routing";
import type { AttachedItem } from "@/components/features/ai/AskAbout";

export type BucketEntry = {
	key: string;
	/** How the assistant came across the publication. */
	source: "read" | "search";
};

type InlineChatLayoutValue = {
	/** The library page is split in two: chat on one side, sources on the other. */
	engaged: boolean;
	setEngaged: (engaged: boolean) => void;
	/**
	 * When the library search field was last asked to take focus. It is a
	 * request rather than a direct call because the field is rebuilt when the
	 * split view closes, after the caller has already finished.
	 */
	searchFocusRequest: number;
	requestSearchFocus: () => void;
	/**
	 * The conversation outlives the page, so opening a result and coming back
	 * keeps it, and a question can be asked before the chat is on screen.
	 * Changing the model starts a new one.
	 */
	getInlineChat: (
		modelId: string,
		greeting: string,
	) => Chat<ResearchUIMessage>;
};

/** Text typed but not yet sent. One owner, so it survives page visits. */
type InlineChatDraftValue = {
	draft: string;
	/** The publication the next question is about, shown as a chip above the box. */
	attached: AttachedItem | null;
};
type InlineChatDraftActions = {
	setDraft: (draft: string) => void;
	setAttached: (item: AttachedItem | null) => void;
};

const InlineChatLayoutContext = createContext<InlineChatLayoutValue>({
	engaged: false,
	setEngaged: () => {},
	searchFocusRequest: 0,
	requestSearchFocus: () => {},
	getInlineChat: () => {
		throw new Error("The library chat is only available inside its page.");
	},
});

/**
 * The draft has its own context so that typing only redraws the message box,
 * not the conversation or the results beside it. Changing it is kept apart
 * from reading it, so the parts of the page that only hand a question over
 * are not redrawn on every key press.
 */
const InlineChatDraftContext = createContext<InlineChatDraftValue>({
	draft: "",
	attached: null,
});
const InlineChatDraftActionsContext = createContext<InlineChatDraftActions>({
	setDraft: () => {},
	setAttached: () => {},
});

/** The split view only exists on the library list page. */
const LIBRARY_PATHNAME = /^\/lib\/?$/;

/**
 * The one conversation the split view uses. It is kept outside React state on
 * purpose: it must survive the chat leaving the screen, and a question may be
 * asked from the search field before the chat is drawn.
 */
function useChatHandle() {
	const chatRef = useRef<{
		modelId: string;
		chat: Chat<ResearchUIMessage>;
	} | null>(null);

	const getInlineChat = useCallback((modelId: string, greeting: string) => {
		if (chatRef.current?.modelId !== modelId) {
			chatRef.current = {
				modelId,
				chat: new Chat<ResearchUIMessage>({
					transport: new DefaultChatTransport({
						api: "/api/ai/chat",
					}),
					messages: [
						createTextMessage("assistant", greeting, "start"),
					],
				}),
			};
		}

		return chatRef.current.chat;
	}, []);

	return getInlineChat;
}

export function InlineChatLayoutProvider({
	children,
}: {
	children: ReactNode;
}) {
	// The flag survives navigation, so opening a result and coming back
	// restores the split view. It only counts on the library page itself.
	// Opening and closing both happen at once. Opening used to be spread over
	// a few frames because it builds the chat and its controls, but that made
	// it wait behind the page's own address changes: a reader who typed and
	// then asked within a moment could be left looking at the old page while
	// the search caught up. Being sure the chat appears is worth the frame.
	const [engaged, setEngagedState] = useState(false);
	const setEngaged = useCallback(
		(next: boolean) => setEngagedState(next),
		[],
	);
	const pathname = usePathname();
	const [searchFocusRequest, setSearchFocusRequest] = useState(0);
	const [draft, setDraft] = useState("");
	const [attached, setAttached] = useState<AttachedItem | null>(null);
	const requestSearchFocus = useCallback(
		() => setSearchFocusRequest(Date.now()),
		[],
	);
	const getInlineChat = useChatHandle();

	const value = useMemo(
		() => ({
			engaged: engaged && LIBRARY_PATHNAME.test(pathname),
			getInlineChat,
			requestSearchFocus,
			searchFocusRequest,
			setEngaged,
		}),
		[
			engaged,
			getInlineChat,
			pathname,
			requestSearchFocus,
			searchFocusRequest,
			setEngaged,
		],
	);
	const draftValue = useMemo(() => ({ draft, attached }), [draft, attached]);
	const draftActions = useMemo(() => ({ setDraft, setAttached }), []);

	return (
		<InlineChatLayoutContext.Provider value={value}>
			<InlineChatDraftActionsContext.Provider value={draftActions}>
				<InlineChatDraftContext.Provider value={draftValue}>
					{children}
				</InlineChatDraftContext.Provider>
			</InlineChatDraftActionsContext.Provider>
		</InlineChatLayoutContext.Provider>
	);
}

export function useInlineChatLayout() {
	return useContext(InlineChatLayoutContext);
}

/** For the message box, which both shows the draft and changes it. */
export function useInlineChatDraft() {
	return {
		...useContext(InlineChatDraftContext),
		...useContext(InlineChatDraftActionsContext),
	};
}

/** For anything that only puts the draft down, such as handing a question over. */
export function useInlineChatDraftActions() {
	return useContext(InlineChatDraftActionsContext);
}
