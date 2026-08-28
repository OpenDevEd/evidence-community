"use client";

import {
	createContext,
	startTransition,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { Chat } from "@ai-sdk/react";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";
import { usePathname } from "@/i18n/routing";

export type BucketEntry = {
	key: string;
	/** How the assistant came across the publication. */
	source: "read" | "search";
};

/** What the chat sends with each question, read at the moment it is sent. */
export type InlineChatRequest = {
	modelId: string;
	mode: ChatMode;
	locale: string;
	searchContext?: LibrarySearchContext;
};

type InlineChatLayoutValue = {
	/** The library page is split in two: chat on one side, sources on the other. */
	engaged: boolean;
	setEngaged: (engaged: boolean) => void;
	/** Publications the assistant has touched, most recent first. */
	bucketEntries: BucketEntry[];
	setBucketEntries: (entries: BucketEntry[]) => void;
	/** Text typed in the AI tab before the split view took over. */
	pendingInput: string;
	setPendingInput: (input: string) => void;
	/** That text came from a real send, so ask it as soon as the chat opens. */
	pendingSend: boolean;
	setPendingSend: (send: boolean) => void;
	/**
	 * When the library search field was last asked to take focus. It is a
	 * request rather than a direct call because the field is rebuilt when the
	 * split view closes, after the caller has already finished.
	 */
	searchFocusRequest: number;
	requestSearchFocus: () => void;
	/**
	 * The conversation outlives the page, so opening a result and coming back
	 * keeps it. Changing the model starts a new one.
	 */
	getChat: (
		modelId: string,
		create: () => Chat<ResearchUIMessage>,
	) => Chat<ResearchUIMessage>;
	/** What the next question should be sent with. */
	getChatRequest: () => InlineChatRequest | null;
	setChatRequest: (request: InlineChatRequest) => void;
	/** Text typed but not yet sent, kept across page visits. */
	composerDraft: string;
	setComposerDraft: (draft: string) => void;
	/** Where the cited PDF pages live, for every publication in the bucket. */
	pdfSources: Record<string, string>;
	registerPdfSources: (
		itemKey: string,
		sources: Record<string, string>,
	) => void;
};

const InlineChatLayoutContext = createContext<InlineChatLayoutValue>({
	engaged: false,
	setEngaged: () => {},
	bucketEntries: [],
	setBucketEntries: () => {},
	pendingInput: "",
	setPendingInput: () => {},
	pendingSend: false,
	setPendingSend: () => {},
	searchFocusRequest: 0,
	requestSearchFocus: () => {},
	getChat: (_modelId, create) => create(),
	getChatRequest: () => null,
	setChatRequest: () => {},
	composerDraft: "",
	setComposerDraft: () => {},
	pdfSources: {},
	registerPdfSources: () => {},
});

/** The split view only exists on the library list page. */
const LIBRARY_PATHNAME = /^\/lib\/?$/;

/** True when both lists hold the same publications in the same order. */
function sameEntries(before: BucketEntry[], after: BucketEntry[]) {
	return (
		before.length === after.length &&
		before.every(
			(entry, index) =>
				entry.key === after[index].key &&
				entry.source === after[index].source,
		)
	);
}

/** True when both records hold exactly the same paths. */
function sameSources(
	before: Record<string, string> | undefined,
	after: Record<string, string>,
) {
	return (
		Boolean(before) &&
		Object.keys(before ?? {}).length === Object.keys(after).length &&
		Object.entries(after).every(([name, path]) => before?.[name] === path)
	);
}

/** Keeps one conversation for the whole visit, and what it has found. */
function useBucket() {
	const [bucketEntries, setEntries] = useState<BucketEntry[]>([]);
	const [pdfSourcesByItem, setPdfSourcesByItem] = useState<
		Record<string, Record<string, string>>
	>({});

	const setBucketEntries = useCallback((entries: BucketEntry[]) => {
		setEntries((previous) =>
			sameEntries(previous, entries) ? previous : entries,
		);
		if (entries.length === 0) setPdfSourcesByItem({});
	}, []);

	const registerPdfSources = useCallback(
		(itemKey: string, sources: Record<string, string>) => {
			setPdfSourcesByItem((previous) =>
				sameSources(previous[itemKey], sources)
					? previous
					: { ...previous, [itemKey]: sources },
			);
		},
		[],
	);

	const pdfSources = useMemo(
		() =>
			Object.assign(
				{},
				...Object.values(pdfSourcesByItem),
			) as Record<string, string>,
		[pdfSourcesByItem],
	);

	return useMemo(
		() => ({
			bucketEntries,
			pdfSources,
			registerPdfSources,
			setBucketEntries,
		}),
		[bucketEntries, pdfSources, registerPdfSources, setBucketEntries],
	);
}

/** The one conversation the split view uses, and what it is sent with. */
function useChatHandle() {
	const chatRef = useRef<{
		modelId: string;
		chat: Chat<ResearchUIMessage>;
	} | null>(null);
	const requestRef = useRef<InlineChatRequest | null>(null);

	const getChat = useCallback(
		(modelId: string, create: () => Chat<ResearchUIMessage>) => {
			if (chatRef.current?.modelId !== modelId) {
				chatRef.current = { modelId, chat: create() };
			}

			return chatRef.current.chat;
		},
		[],
	);
	const getChatRequest = useCallback(() => requestRef.current, []);
	const setChatRequest = useCallback((request: InlineChatRequest) => {
		requestRef.current = request;
	}, []);

	return useMemo(
		() => ({ getChat, getChatRequest, setChatRequest }),
		[getChat, getChatRequest, setChatRequest],
	);
}

export function InlineChatLayoutProvider({
	children,
}: {
	children: ReactNode;
}) {
	// The flag survives navigation, so opening a result and coming back
	// restores the split view. It only counts on the library page itself.
	const [engagedState, setEngagedState] = useState(false);
	const setEngaged = useCallback((engaged: boolean) => {
		// Opening builds the chat and its controls, which is heavy work, so
		// React is allowed to spread it over a few frames. Closing only swaps
		// the light search controls back in, so it happens at once.
		if (engaged) startTransition(() => setEngagedState(true));
		else setEngagedState(false);
	}, []);
	const pathname = usePathname();
	const [pendingInput, setPendingInput] = useState("");
	const [pendingSend, setPendingSend] = useState(false);
	const [searchFocusRequest, setSearchFocusRequest] = useState(0);
	const [composerDraft, setComposerDraft] = useState("");
	const requestSearchFocus = useCallback(
		() => setSearchFocusRequest(Date.now()),
		[],
	);
	const bucket = useBucket();
	const handle = useChatHandle();

	const value = useMemo(
		() => ({
			...bucket,
			...handle,
			composerDraft,
			engaged: engagedState && LIBRARY_PATHNAME.test(pathname),
			pendingInput,
			pendingSend,
			requestSearchFocus,
			searchFocusRequest,
			setComposerDraft,
			setEngaged,
			setPendingInput,
			setPendingSend,
		}),
		[
			bucket,
			composerDraft,
			engagedState,
			handle,
			pathname,
			pendingInput,
			pendingSend,
			requestSearchFocus,
			searchFocusRequest,
			setEngaged,
		],
	);

	return (
		<InlineChatLayoutContext.Provider value={value}>
			{children}
		</InlineChatLayoutContext.Provider>
	);
}

export function useInlineChatLayout() {
	return useContext(InlineChatLayoutContext);
}
