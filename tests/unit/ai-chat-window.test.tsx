// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
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
vi.mock("@/lib/analytics", () => ({ getAnalyticsDistinctId: () => "test" }));
vi.mock("@/lib/actions", () => ({ convertItem: vi.fn() }));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		ai: { providers: [] },
		features: { aiSearch: true, deepResearch: true },
		identity: {
			name: "Test Library",
			assets: { logoLight: "/logo.png", logoDark: "/logo.png" },
			fundingPartners: [],
		},
		navigation: { links: [] },
		theme: { layout: "wide" },
	}),
	useLibraryFeature: () => true,
}));

import ChatModal, {
	type ChatWindowHandle,
} from "@/components/features/modals/ChatModal";

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
/** Set when a test wants the assistant to fail. */
const service = { fails: false };

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

describe("the full-screen chat window", () => {
	let container: HTMLDivElement;
	let root: Root;
	let asked: Record<string, unknown>[];

	beforeEach(() => {
		window.localStorage.clear();
		answering.held = false;
		answering.release = () => {};
		service.fails = false;
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

				if (service.fails) {
					return new Response("The assistant is unavailable.", {
						status: 500,
					});
				}

				return new Response(answerStream("Two studies say yes."), {
					headers: { "Content-Type": "text/event-stream" },
				});
			}),
		);
	});

	async function press(label: string) {
		const button = document.body.querySelector(
			`button[aria-label="${label}"]`,
		);
		if (!button) throw new Error(`the ${label} button is missing`);
		await act(async () => {
			button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

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

	async function render(
		props: Partial<Parameters<typeof ChatModal>[0]> = {},
	) {
		await act(async () => {
			root.render(
				<ChatModal
					isOpen
					onOpenChange={vi.fn()}
					modelId="gemini-2.5-flash"
					{...props}
				/>,
			);
		});
	}

	function composer() {
		const field = document.body.querySelector("textarea");
		if (!field) throw new Error("the message box is missing");

		return field;
	}

	async function ask(question: string) {
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setter?.call(composer(), question);
			composer().dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			composer().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
	}

	it("shows the question and the answer that comes back", async () => {
		await render();
		await ask("Does teacher training help?");

		expect(document.body.textContent).toContain(
			"Does teacher training help?",
		);
		expect(document.body.textContent).toContain("Two studies say yes.");
	});

	it("reports when a conversation starts so outside model controls can warn", async () => {
		const onConversationStateChange = vi.fn();
		await render({ onConversationStateChange });

		await ask("Does teacher training help?");

		expect(onConversationStateChange).toHaveBeenCalledWith(true);
	});

	it("offers the model picker in the full-screen controls", async () => {
		await render({ onModelChange: vi.fn() });

		expect(
			document.body.querySelector('button[aria-label="change"]'),
		).not.toBeNull();
	});

	it("tells the assistant which publication is open", async () => {
		await render({
			data: {
				item: { key: "ABC123", title: "Teacher training in Kenya" },
			} as Parameters<typeof ChatModal>[0]["data"],
		});
		await ask("What does it say?");

		expect(asked[0]).toMatchObject({
			itemKey: "ABC123",
			modelId: "gemini-2.5-flash",
		});
	});

	// The page opens the window and hands over the question in the same
	// click, so nothing has to watch for a question arriving later.
	it("asks a question the page hands to it", async () => {
		const window = createRef<ChatWindowHandle>();
		await render({ ref: window });
		expect(asked).toHaveLength(0);

		await act(async () => {
			window.current?.ask("Which countries were studied?");
		});

		expect(asked).toHaveLength(1);
		expect(document.body.textContent).toContain(
			"Which countries were studied?",
		);
	});

	// The AI service runs two questions at once and mixes the answers, so a
	// second question has to wait, and the page must keep it.
	it("refuses a second question while an answer is still arriving", async () => {
		answering.held = true;
		const window = createRef<ChatWindowHandle>();
		await render({ ref: window });

		let first: boolean | undefined;
		let second: boolean | undefined;
		// Both in one go, the way two quick clicks arrive.
		await act(async () => {
			first = window.current?.ask("Which countries were studied?");
			second = window.current?.ask("And for how long?");
		});

		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(asked).toHaveLength(1);
	});

	// The window is built once and kept, so a later choice has to travel with
	// the question rather than sit in the conversation it was built with.
	it("sends the mode the reader has just chosen", async () => {
		await render();
		await press("researchMode");
		await ask("Does teacher training help?");

		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({ mode: "research" });
	});

	it("sends the mode the reader has just chosen when trying again", async () => {
		service.fails = true;
		await render();
		await ask("Does teacher training help?");
		expect(asked[0]).toMatchObject({ mode: "quick" });

		service.fails = false;
		await press("researchMode");
		await press("retry");

		expect(asked).toHaveLength(2);
		expect(asked[1]).toMatchObject({ mode: "research" });
	});

	it("ignores an empty question from the page", async () => {
		const window = createRef<ChatWindowHandle>();
		await render({ ref: window });

		await act(async () => {
			window.current?.ask("   ");
		});

		expect(asked).toHaveLength(0);
	});
});
