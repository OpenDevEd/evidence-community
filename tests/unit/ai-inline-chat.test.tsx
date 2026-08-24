// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl", () => ({
	useLocale: () => "en-GB",
	useTranslations: () => Object.assign((key: string) => key, {
		rich: (key: string) => key,
	}),
}));
vi.mock("@/i18n/routing", () => ({
	usePathname: () => "/lib",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
	Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/lib/analytics", () => ({ getAnalyticsDistinctId: () => "test" }));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		ai: {
			providers: [
				{
					provider: "google",
					enabled: true,
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
import { InlineChatLayoutProvider } from "@/context/InlineChatLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

// The test page has no layout engine, so nothing ever changes size.
class NoResize {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

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
		start(controller) {
			const encoder = new TextEncoder();
			for (const chunk of chunks) {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
				);
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
}

describe("the chat beside the search results", () => {
	let container: HTMLDivElement;
	let root: Root;
	let asked: unknown[];

	beforeEach(() => {
		window.localStorage.clear();
		asked = [];
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				asked.push(JSON.parse(String(init.body)));

				return new Response(answerStream("Two studies say yes."), {
					headers: { "Content-Type": "text/event-stream" },
				});
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	async function render() {
		await act(async () => {
			root.render(
				<InlineChatLayoutProvider>
					<InlineLibraryChat modelId="gemini-2.5-flash" />
				</InlineChatLayoutProvider>,
			);
		});
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
		await render();
		await type("Does teacher training help?");
		await send();

		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			modelId: "gemini-2.5-flash",
			mode: "quick",
		});
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

	it("ignores an empty question", async () => {
		await render();
		await send();

		expect(asked).toHaveLength(0);
	});
});
