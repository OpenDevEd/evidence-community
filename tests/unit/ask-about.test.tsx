// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const place = vi.hoisted(() => ({ pathname: "/digests", ai: true }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/routing", () => ({ usePathname: () => place.pathname }));
vi.mock("@/context/LibraryConfigProvider", () => ({ useLibraryFeature: () => place.ai }));
vi.mock("@/hooks/useSelectedModel", () => ({ useSelectedModel: () => ({ selectedModelId: "gemini-2.5-flash", setSelectedModelId: vi.fn() }) }));
// The window itself is the chat's own concern; here it only shows which publication it was opened about.
vi.mock("@/components/features/modals/ChatModal", () => ({
	default: ({ isOpen, publication }: { isOpen: boolean; publication?: { title: string } }) =>
		isOpen ? <div role="dialog" aria-label={`Chat about ${publication?.title}`} /> : null,
}));

import { AskAboutButton } from "@/components/features/ai/AskAbout";
import { AskAboutHost } from "@/components/features/ai/AskAboutHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("where readers can ask AI about a publication", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		Object.assign(place, { pathname: "/digests", ai: true });
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	const render = () => act(async () => root.render(
		<AskAboutHost><AskAboutButton item={{ key: "ABCD1234", title: "Radio lessons in Kenya" }} /></AskAboutHost>,
	));
	const button = () => container.querySelector<HTMLButtonElement>('button[aria-label="askAI"]');

	it("opens the chat about the publication from a public page", async () => {
		await render();
		await act(async () => button()?.click());
		expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Chat about Radio lessons in Kenya");
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
