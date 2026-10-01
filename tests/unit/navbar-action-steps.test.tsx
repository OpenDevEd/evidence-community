// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en-GB.json";

const session = vi.hoisted(() => ({
	reader: null as { id: string; name: string; image: string | null } | null,
	features: { readerAccounts: true, themeSwitcher: true, languageSwitcher: true } as Record<string, boolean>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/lib" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useRuntimeLocaleNavigation", () => ({ useRuntimeLocaleNavigation: () => vi.fn() }));
vi.mock("@/components/layout/navbar/LanguageSwitcher", () => ({
	default: () => <button aria-label="Choose language">English (UK)</button>,
	useLibraryLanguages: () => ["en-GB", "fr"],
	languageMenuItems: () => [],
	languageName: (locale: string) => locale,
}));
vi.mock("@/components/layout/navbar/ReaderSession", () => ({
	useReaderSession: () => ({ reader: session.reader, signIn: vi.fn(), signOut: vi.fn() }),
	useOpenScholarAccountUrl: () => "https://accounts.openscholar.example.org/user",
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: (feature: string) => session.features[feature] ?? false,
	useLibraryConfig: () => ({ features: session.features, localization: { locales: ["en-GB", "fr"] } }),
}));

import NavbarActionSteps from "@/components/layout/navbar/NavbarActionSteps";
import { navbarActionSteps, type NavbarSetting } from "@/lib/navbar-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** The controls each step shows, by accessible name, widest step first. */
function renderSteps(settings: NavbarSetting[], signIn: boolean) {
	act(() => {
		root.render(
			<NextIntlClientProvider locale="en-GB" messages={messages} timeZone="UTC">
				<NavbarActionSteps
					steps={navbarActionSteps(settings, signIn)}
					context={{ session: session.reader, styleVariant: "small", theme: "light", setTheme: vi.fn() }}
				/>
			</NextIntlClientProvider>,
		);
	});
	return [...container.querySelectorAll("nav")].map((step) =>
		[...step.querySelectorAll("button")]
			.map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "")
			// The phone-sized Sign in button is a second copy of the same control.
			.filter((name, index, names) => names.indexOf(name) === index),
	);
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	session.reader = null;
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("the header's action steps", () => {
	it("shows a library's only setting as its own button, not a menu of one", () => {
		const steps = renderSteps(["theme"], false);
		expect(steps).toHaveLength(1);
		expect(steps[0]).toHaveLength(1);
		expect(steps[0]).toEqual(["Switch to dark mode"]);
	});

	it("folds the settings behind one button, then everything into one menu, as the bar narrows", () => {
		const steps = renderSteps(["theme", "language"], true);
		expect(steps).toHaveLength(3);
		expect(steps[0]).toHaveLength(3);
		expect(steps[0]).toEqual(expect.arrayContaining(["Choose language", "Sign in"]));
		expect(steps[1]).toEqual(["Settings", "Sign in"]);
		expect(steps[2]).toEqual(["Actions menu"]);
	});

	it("shows only the signed-in reader's avatar at every step", () => {
		session.reader = { id: "reader-amina", name: "Amina Okafor", image: null };
		const steps = renderSteps(["theme", "language"], true);
		expect(steps).toEqual([["Your account"], ["Your account"], ["Your account"]]);
	});
});
