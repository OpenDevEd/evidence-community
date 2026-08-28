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
vi.mock("next-auth", () => ({}));
vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: null, status: "unauthenticated" }),
}));
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

describe("the full-screen chat window", () => {
	let container: HTMLDivElement;
	let root: Root;
	let asked: Record<string, unknown>[];

	beforeEach(() => {
		window.localStorage.clear();
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

	it("ignores an empty question from the page", async () => {
		const window = createRef<ChatWindowHandle>();
		await render({ ref: window });

		await act(async () => {
			window.current?.ask("   ");
		});

		expect(asked).toHaveLength(0);
	});
});
