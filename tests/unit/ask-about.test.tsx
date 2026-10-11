// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const place = vi.hoisted(() => ({ pathname: "/digests", ai: true, aiSearch: true, model: "gemini-2.5-flash" }));
const inline = vi.hoisted(() => ({ setAttached: vi.fn(), setEngaged: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/routing", () => ({ usePathname: () => place.pathname }));
vi.mock("@/context/LibraryConfigProvider", () => ({ useLibraryFeature: (feature: string) => (feature === "aiSearch" ? place.aiSearch : place.ai) }));
vi.mock("@/context/InlineChatLayout", () => ({ useInlineChatLayout: () => ({ setEngaged: inline.setEngaged }), useInlineChatDraftActions: () => ({ setAttached: inline.setAttached }) }));
vi.mock("@/hooks/useSelectedModel", () => ({ useSelectedModel: () => ({ selectedModelId: place.model, setSelectedModelId: vi.fn() }) }));
// The window itself is the chat's own concern; here it only shows which publication it was opened about.
vi.mock("@/components/features/modals/ChatModal", () => ({
	default: ({ isOpen, publication }: { isOpen: boolean; publication?: { title: string } | null }) =>
		isOpen ? <div role="dialog" aria-label={`Chat about ${publication?.title}`} /> : null,
}));
// The window loads lazily in the app; here it is there at once.
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<{ default: unknown }>) => { let Loaded: React.ComponentType<Record<string, unknown>> | null = null; void load().then(module => { Loaded = module.default as never; }); return (props: Record<string, unknown>) => (Loaded ? <Loaded {...props} /> : null); } }));

import { AskAboutButton } from "@/components/features/ai/AskAbout";
import { AskAboutHere } from "@/components/features/ai/AskAboutHere";
import { AskAboutHost } from "@/components/features/ai/AskAboutHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("where readers can ask AI about a publication", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		Object.assign(place, { pathname: "/digests", ai: true, aiSearch: true, model: "gemini-2.5-flash" });
		inline.setAttached.mockClear();
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	const render = () => act(async () => root.render(
		<AskAboutHost>
			<AskAboutButton item={{ key: "ABCD1234", title: "Radio lessons in Kenya" }} />
			<AskAboutButton item={{ key: "EFGH5678", title: "Tutoring by phone" }} />
		</AskAboutHost>,
	));
	const button = (index = 0) => container.querySelectorAll<HTMLButtonElement>('button[aria-label="askAI"]')[index] ?? null;
	const dialog = () => container.querySelector('[role="dialog"]')?.getAttribute("aria-label");

	it("opens the chat about the publication from a public page", async () => {
		await render();
		await act(async () => button()?.click());
		expect(dialog()).toBe("Chat about Radio lessons in Kenya");
	});

	it("keeps the publication attached last when the reader changes model", async () => {
		await render();
		await act(async () => button(0)?.click());
		await act(async () => button(1)?.click());
		place.model = "gpt-6-luna";
		await render();
		expect(dialog()).toBe("Chat about Tutoring by phone");
	});

	it("on the library page, joins the chat beside the results, or the full-screen chat where the library has no AI search", async () => {
		place.pathname = "/lib";
		const renderLibrary = () => act(async () => root.render(
			<AskAboutHost><AskAboutHere ownList={false}><AskAboutButton item={{ key: "ABCD1234", title: "Radio lessons in Kenya" }} /></AskAboutHere></AskAboutHost>,
		));
		await renderLibrary();
		await act(async () => button()?.click());
		expect(inline.setAttached).toHaveBeenCalledWith({ key: "ABCD1234", title: "Radio lessons in Kenya" });
		expect(dialog()).toBeUndefined();

		inline.setAttached.mockClear();
		place.aiSearch = false;
		await renderLibrary();
		await act(async () => button()?.click());
		expect(inline.setAttached).not.toHaveBeenCalled();
		expect(dialog()).toBe("Chat about Radio lessons in Kenya");
	});

	it("offers nothing in the admin, which has no chat", async () => {
		place.pathname = "/admin/preview/ABCD1234";
		await render();
		expect(button()).toBeNull();
	});

	it("offers nothing when the library has AI off", async () => {
		place.ai = false;
		await render();
		expect(button()).toBeNull();
	});
});
