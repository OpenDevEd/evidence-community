"use client";

import {
	createContext,
	startTransition,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type MutableRefObject,
	type ReactNode,
} from "react";
import type { Chat } from "@ai-sdk/react";
import type { ChatMode, Message } from "@/components/features/modals/ChatModal";
import type { LibrarySearchContext } from "@/lib/search-context";
import { usePathname } from "@/i18n/routing";

export type BucketEntry = {
	key: string;
	/** How the model surfaced the publication. */
	source: "read" | "search";
};

/** Per-request values the shared chat transport reads at send time. */
export type InlineChatRequest = {
	modelId: string;
	mode: ChatMode;
	locale: string;
	searchContext?: LibrarySearchContext;
};

type InlineChatLayoutValue = {
	/** The library page is in split chat mode (chat left, context right). */
	engaged: boolean;
	setEngaged: (engaged: boolean) => void;
	/** Publications the model has touched, most recently touched first. */
	bucketEntries: BucketEntry[];
	setBucketEntries: (entries: BucketEntry[]) => void;
	/** Text typed in the AI tab before the split layout took over. */
	pendingInput: string;
	setPendingInput: (input: string) => void;
	/** The pending input came from an explicit submit and should auto-send. */
	pendingSend: boolean;
	setPendingSend: (send: boolean) => void;
	/** The search text Ask AI took as its question; closing the chat puts it back. */
	askedSearchRef: MutableRefObject<string>;
	/**
	 * Timestamp of the last request to focus the main library search field.
	 * A request rather than a direct focus() call because the field remounts
	 * when the split layout closes, after the caller has already run.
	 */
	searchFocusRequest: number;
	requestSearchFocus: () => void;
	/**
	 * The conversation outlives the library page (navigating into a result
	 * and back must not lose it), so the AI SDK `Chat` instance lives here
	 * rather than in the chat component. Changing the model starts a new
	 * conversation, so the instance is replaced when `modelId` differs.
	 */
	getChat: (modelId: string, create: () => Chat<Message>) => Chat<Message>;
	/** Live request values for the shared transport; written every render. */
	chatRequestRef: MutableRefObject<InlineChatRequest | null>;
	/** Unsent composer text, kept across page visits. */
	composerDraft: string;
	setComposerDraft: (draft: string) => void;
	/** Merged PDF citation sources for every bucket publication. */
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
	askedSearchRef: { current: "" },
	searchFocusRequest: 0,
	requestSearchFocus: () => {},
	getChat: (_modelId, create) => create(),
	chatRequestRef: { current: null },
	composerDraft: "",
	setComposerDraft: () => {},
	pdfSources: {},
	registerPdfSources: () => {},
});

/** The split layout only exists on the library list page. */
const LIBRARY_PATHNAME = /^\/lib\/?$/;

export function InlineChatLayoutProvider({ children }: { children: ReactNode }) {
	// The raw flag persists across navigation so opening a result and coming
	// back restores the split; consumers (navbar, page, results view) only see
	// it while on the library page itself.
	const [engagedState, setEngagedState] = useState(false);
	// Engaging mounts the chat plus a set of NextUI controls; as a transition
	// React time-slices that render instead of blocking the click's frame, and
	// the CSS/motion transitions still start together on the single commit.
	const setEngaged = useCallback((engaged: boolean) => {
		// Opening mounts the chat and its controls (heavy) → time-sliced.
		// Closing only swaps in the light search controls (the results list
		// stays mounted), so it commits immediately and the controls start
		// fading in on the very next frame.
		if (engaged) startTransition(() => setEngagedState(true));
		else setEngagedState(false);
	}, []);
	const pathname = usePathname();
	const engaged = engagedState && LIBRARY_PATHNAME.test(pathname);
	const [bucketEntries, setBucketEntriesState] = useState<BucketEntry[]>([]);
	const [pendingInput, setPendingInput] = useState("");
	const [pendingSend, setPendingSend] = useState(false);
	const askedSearchRef = useRef("");
	const [searchFocusRequest, setSearchFocusRequest] = useState(0);
	const requestSearchFocus = useCallback(
		() => setSearchFocusRequest(Date.now()),
		[],
	);
	const chatRef = useRef<{ modelId: string; chat: Chat<Message> } | null>(
		null,
	);
	const getChat = useCallback(
		(modelId: string, create: () => Chat<Message>) => {
			if (chatRef.current?.modelId !== modelId) {
				chatRef.current = { modelId, chat: create() };
			}
			return chatRef.current.chat;
		},
		[],
	);
	const chatRequestRef = useRef<InlineChatRequest | null>(null);
	const [composerDraft, setComposerDraft] = useState("");
	const [pdfSourcesByItem, setPdfSourcesByItem] = useState<
		Record<string, Record<string, string>>
	>({});

	const setBucketEntries = useCallback((entries: BucketEntry[]) => {
		setBucketEntriesState((previous) =>
			previous.length === entries.length &&
			previous.every(
				(entry, index) =>
					entry.key === entries[index].key &&
					entry.source === entries[index].source,
			)
				? previous
				: entries,
		);
		if (entries.length === 0) setPdfSourcesByItem({});
	}, []);

	const registerPdfSources = useCallback(
		(itemKey: string, sources: Record<string, string>) => {
			setPdfSourcesByItem((previous) => {
				const existing = previous[itemKey];
				if (
					existing &&
					Object.keys(existing).length ===
						Object.keys(sources).length &&
					Object.entries(sources).every(
						([name, path]) => existing[name] === path,
					)
				) {
					return previous;
				}
				return { ...previous, [itemKey]: sources };
			});
		},
		[],
	);

	const pdfSources = useMemo(
		() => Object.assign({}, ...Object.values(pdfSourcesByItem)),
		[pdfSourcesByItem],
	);

	const value = useMemo(
		() => ({
			engaged,
			setEngaged,
			bucketEntries,
			setBucketEntries,
			pendingInput,
			setPendingInput,
			pendingSend,
			setPendingSend,
			askedSearchRef,
			searchFocusRequest,
			requestSearchFocus,
			getChat,
			chatRequestRef,
			composerDraft,
			setComposerDraft,
			pdfSources,
			registerPdfSources,
		}),
		[
			engaged,
			bucketEntries,
			setBucketEntries,
			pendingInput,
			pendingSend,
			searchFocusRequest,
			requestSearchFocus,
			getChat,
			composerDraft,
			pdfSources,
			registerPdfSources,
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
