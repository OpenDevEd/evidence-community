// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl", () => ({
	useLocale: () => "en-GB",
	useTranslations: () =>
		Object.assign((key: string) => key, {
			rich: (key: string) => key,
		}),
}));
vi.mock("@/i18n/routing", () => ({
	usePathname: () => "/lib",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
	Link: ({ children }: { children: unknown }) => children,
}));
// The real reader has no analytics id until they agree to analytics, and
// then it is null, not missing.
const analyticsId = { value: null as string | null };
vi.mock("@/lib/analytics", () => ({
	getAnalyticsDistinctId: () => analyticsId.value,
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		ai: {
			providers: [
				{
					provider: "google",
					enabled: true,
					models: ["gemini-2.5-flash"],
					defaultModel: "gemini-2.5-flash",
				},
			],
		},
		features: { aiSearch: true, deepResearch: false },
		theme: { layout: "wide" },
	}),
	useLibraryFeature: (feature: string) => feature === "aiSearch",
}));
// Signed-in state belongs to the page around the chat.
vi.mock("next-auth", () => ({}));
// Server actions belong to the pages around the chat.
vi.mock("@/lib/actions", () => ({ convertItem: vi.fn() }));
vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: null, status: "unauthenticated" }),
}));

import InlineLibraryChat from "@/components/features/ai/InlineLibraryChat";
import { useAskInlineChat } from "@/components/features/ai/useAskInlineChat";
import { InlineChatLayoutProvider } from "@/context/InlineChatLayout";
import {
	normalizeLibrarySearchContext,
	type LibrarySearchContext,
} from "@/lib/search-context";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The test page has no layout engine, so nothing ever changes size.
class NoResize {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

/** Set while a test wants the answer to stay half-written. */
const answering = { held: false, release: () => {} };

/** One answer, streamed back the way the AI service sends it. */
function answerStream(text: string) {
	const chunks = [
		{ type: "start" },
		{ type: "text-start", id: "0" },
		{ type: "text-delta", id: "0", delta: text },
		{ type: "text-end", id: "0" },
		{ type: "finish" },
	];

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (chunk: unknown) =>
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
				);

			send(chunks[0]);
			if (answering.held) {
				await new Promise<void>((resolve) => {
					answering.release = resolve;
				});
			}
			for (const chunk of chunks.slice(1)) send(chunk);
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
}

describe("the chat beside the search results", () => {
	let container: HTMLDivElement;
	let root: Root;
	let asked: Record<string, unknown>[];

	beforeEach(() => {
		window.localStorage.clear();
		answering.held = false;
		answering.release = () => {};
		analyticsId.value = null;
		asked = [];
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				asked.push(
					JSON.parse(String(init.body)) as Record<string, unknown>,
				);

				return new Response(answerStream("Two studies say yes."), {
					headers: { "Content-Type": "text/event-stream" },
				});
			}),
		);
	});

	afterEach(async () => {
		answering.release();
		// The window draws into the page itself, so it has to be taken down
		// or the next test types into the one before it.
		await act(async () => {
			root.unmount();
		});
		container.remove();
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	/** The chat, with nothing of interest beside it. */
	function Chat() {
		return <InlineLibraryChat modelId="gemini-2.5-flash" />;
	}

	async function render() {
		await act(async () => {
			root.render(
				<InlineChatLayoutProvider>
					<Chat />
				</InlineChatLayoutProvider>,
			);
		});
	}

	/**
	 * Stands in for the search field handing a question to the chat. The page
	 * shows the chat because the reader asked, not because a question is
	 * waiting. Clearing the field changes the page address, which rebuilds the
	 * chat once, so the stand-in can do that too.
	 */
	function AskFromThePage({
		openFirst = false,
		question,
		rebuild,
		searchContext,
	}: {
		openFirst?: boolean;
		question: string;
		rebuild: boolean;
		searchContext?: LibrarySearchContext;
	}) {
		const askAI = useAskInlineChat(searchContext);
		const [engaged, setEngaged] = useState(openFirst);
		const [rebuilt, setRebuilt] = useState(false);
		const [accepted, setAccepted] = useState<boolean[]>([]);
		const gone = rebuild && !rebuilt;

		return (
			<>
				<button
					type="button"
					data-testid="ask"
					onClick={() => {
						setAccepted((before) => [...before, askAI(question)]);
						setEngaged(true);
					}}
				>
					hand over
				</button>
				<output data-testid="accepted">{accepted.join(",")}</output>
				<button
					type="button"
					data-testid="settle"
					onClick={() => setRebuilt(true)}
				>
					settle
				</button>
				{engaged && !gone ? <Chat /> : null}
			</>
		);
	}

	async function press(testId: string) {
		await act(async () => {
			container
				.querySelector(`[data-testid="${testId}"]`)
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	async function handOver(
		question: string,
		rebuild = false,
		searchContext?: LibrarySearchContext,
	) {
		await act(async () => {
			root.render(
				<InlineChatLayoutProvider>
					<AskFromThePage
						question={question}
						rebuild={rebuild}
						searchContext={searchContext}
					/>
				</InlineChatLayoutProvider>,
			);
		});
		await press("ask");
	}

	function composer() {
		const field = container.querySelector("textarea");
		if (!field) throw new Error("the message box is missing");

		return field;
	}

	async function type(text: string) {
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setter?.call(composer(), text);
			composer().dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	async function send() {
		await act(async () => {
			composer().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
	}

	it("opens ready for a question, with nothing asked yet", async () => {
		await render();

		expect(composer().value).toBe("");
		expect(asked).toHaveLength(0);
	});

	it("shows the question and the answer that comes back", async () => {
		await render();
		await type("Does teacher training help?");
		await send();

		expect(container.textContent).toContain("Does teacher training help?");
		expect(container.textContent).toContain("Two studies say yes.");
		expect(composer().value).toBe("");
	});

	it("sends the chosen model and mode with the question", async () => {
		analyticsId.value = "reader-1";
		await render();
		await type("Does teacher training help?");
		await send();

		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			distinctId: "reader-1",
			modelId: "gemini-2.5-flash",
			mode: "quick",
		});
	});

	// A reader who turns cookies down has no analytics id. Sending an empty
	// one made the library refuse every question they asked.
	it("leaves the analytics id out when there is none", async () => {
		analyticsId.value = null;
		await render();
		await type("Does teacher training help?");
		await send();

		expect(asked).toHaveLength(1);
		expect(Object.keys(asked[0] as object)).not.toContain("distinctId");
	});

	it("keeps the text when Shift and Enter are pressed together", async () => {
		await render();
		await type("Half a question");
		await act(async () => {
			composer().dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					shiftKey: true,
					bubbles: true,
				}),
			);
		});

		expect(asked).toHaveLength(0);
		expect(composer().value).toBe("Half a question");
	});

	it("asks a question handed over from the page as it opens", async () => {
		await handOver("Does teacher training help?");

		expect(asked).toHaveLength(1);
		expect(container.textContent).toContain("Does teacher training help?");
	});

	it("uses the search text as a question while keeping the selected filters", async () => {
		const question = "Which publications discuss country focus?";
		await handOver(
			question,
			true,
			normalizeLibrarySearchContext({
				search: question,
				country: ["KE"],
				collections: ["SACU3G3A"],
				range: "2024-2026",
				scope: "title",
			}),
		);
		await press("settle");

		const context = {
			search: "",
			country: ["KE"],
			collections: ["SACU3G3A"],
			range: "2024-2026",
			scope: "title",
			author: "",
			institution: [],
			sort: "relevance",
		};
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			searchContext: context,
			messages: expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					parts: expect.arrayContaining([
						{ type: "text", text: question },
						expect.objectContaining({
							type: "data-requestContext",
							data: expect.objectContaining({ searchContext: context }),
						}),
					]),
				}),
			]),
		});
	});

	it("still asks the question when the page rebuilds the chat", async () => {
		// The chat is not there when the reader asks; the page settles first.
		await handOver("Does teacher training help?", true);
		await press("settle");

		expect(asked).toHaveLength(1);
		expect(container.textContent).toContain("Does teacher training help?");
	});

	// The question is sent before the chat is drawn, so the model and the
	// mode have to travel with it rather than come from the chat.
	it("sends the chosen model and mode with a handed-over question", async () => {
		analyticsId.value = "reader-1";
		await handOver("Does teacher training help?");

		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			distinctId: "reader-1",
			modelId: "gemini-2.5-flash",
			mode: "quick",
		});
	});

	it("asks a question that arrives after it has opened", async () => {
		// The chat is already open when the reader asks from the page.
		await act(async () => {
			root.render(
				<InlineChatLayoutProvider>
					<AskFromThePage
						question="Does teacher training help?"
						rebuild={false}
						openFirst
					/>
				</InlineChatLayoutProvider>,
			);
		});
		expect(asked).toHaveLength(0);

		await press("ask");

		expect(asked).toHaveLength(1);
		expect(container.textContent).toContain("Does teacher training help?");
	});

	// The AI service runs two questions at once and mixes the answers, so the
	// second of two quick clicks has to be turned away.
	it("does not ask the same question twice when the reader hurries", async () => {
		answering.held = true;
		await handOver("Does teacher training help?");
		expect(asked).toHaveLength(1);

		await press("ask");

		expect(asked).toHaveLength(1);
		expect(
			container.querySelector('[data-testid="accepted"]')?.textContent,
		).toBe("true,false");
	});

	it("ignores an empty question", async () => {
		await render();
		await send();

		expect(asked).toHaveLength(0);
	});
});
