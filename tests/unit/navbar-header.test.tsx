// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en-GB.json";
import type { NavbarActionSlot } from "@/lib/navbar-actions";

const page = vi.hoisted(() => ({
	pathname: "/contact",
	features: {} as Record<string, boolean>,
	locales: ["en-GB"] as string[],
	layout: "small",
	chatEngaged: false,
	steps: [] as NavbarActionSlot[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("@/i18n/routing", () => ({ usePathname: () => page.pathname }));
vi.mock("@/context/InlineChatLayout", () => ({ useInlineChatLayout: () => ({ engaged: page.chatEngaged }) }));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: (feature: string) => page.features[feature] ?? false,
	useLibraryConfig: () => ({
		features: page.features,
		localization: { locales: page.locales },
		theme: { layout: page.layout },
	}),
}));
vi.mock("@/components/layout/navbar/ReaderSession", () => ({ useReaderSession: () => ({ reader: null }) }));
// The header's own parts are under test here, not what each part draws.
vi.mock("@/components/layout/navbar/Logo", () => ({ Logo: () => null }));
vi.mock("@/components/layout/navbar/NavLinks", () => ({ default: () => null }));
vi.mock("@/components/layout/navbar/MobileMenu", () => ({ default: () => null }));
vi.mock("@/components/layout/navbar/NavbarSearch", () => ({ default: () => <div data-testid="navbar-search" /> }));
vi.mock("@/components/layout/navbar/NavbarActionSteps", () => ({
	default: ({ steps }: { steps: NavbarActionSlot[][] }) => {
		page.steps = steps;
		return null;
	},
}));

import Navbar from "@/components/layout/navbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render() {
	act(() => {
		root.render(
			<NextIntlClientProvider locale="en-GB" messages={messages} timeZone="UTC">
				<Navbar />
			</NextIntlClientProvider>,
		);
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	Object.assign(page, { pathname: "/contact", features: {}, locales: ["en-GB"], layout: "small", chatEngaged: false, steps: [] });
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("the library header", () => {
	it("arranges the actions the library offers", () => {
		page.features = { themeSwitcher: true, languageSwitcher: true, readerAccounts: true };
		page.locales = ["en-GB", "fr"];
		render();
		expect(page.steps.map((slots) => slots.map((slot) => slot.kind))).toEqual([
			["setting", "setting", "signIn"],
			["settingsMenu", "signIn"],
			["menu"],
		]);
	});

	it("offers no language choice for a library with one language", () => {
		page.features = { themeSwitcher: true, languageSwitcher: true };
		render();
		expect(page.steps).toEqual([[{ kind: "setting", setting: "theme" }]]);
	});

	it("shows its search bar only on pages without one of their own", () => {
		page.features = { navbarSearch: true };
		render();
		expect(container.querySelector('[data-testid="navbar-search"]')).not.toBeNull();
		for (const pathname of ["/lib", "/map", "/profile/reader-1", "/"]) {
			page.pathname = pathname;
			render();
			expect(container.querySelector('[data-testid="navbar-search"]'), pathname).toBeNull();
		}
	});

	it("keeps its place beside the chat in both styles", () => {
		page.chatEngaged = true;
		for (const layout of ["small", "wide"]) {
			page.layout = layout;
			render();
			expect(container.querySelector("#site-header")).not.toBeNull();
		}
	});
});
