// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en-GB.json";

const session = vi.hoisted(() => ({
	reader: null as { id: string; name: string; image: string | null } | null,
	signIn: vi.fn(),
	signOut: vi.fn(),
	features: { readerAccounts: true, themeSwitcher: true, languageSwitcher: false },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/lib" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useRuntimeLocaleNavigation", () => ({ useRuntimeLocaleNavigation: () => vi.fn() }));
vi.mock("@/components/layout/navbar/LanguageSwitcher", () => ({ useLibraryLanguages: () => [], languageMenuItems: () => [] }));
vi.mock("@/components/layout/navbar/ReaderSession", () => ({
	useReaderSession: () => ({ reader: session.reader, signIn: session.signIn, signOut: session.signOut }),
	useOpenScholarAccountUrl: () => "https://accounts.openscholar.example.org/user",
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: (feature: keyof typeof session.features) => session.features[feature] ?? false,
	useLibraryConfig: () => ({ features: session.features, localization: { locales: ["en-GB"] } }),
}));

import ActionsDropdown from "@/components/layout/navbar/ActionsDropdown";
import LoginButton from "@/components/layout/navbar/LoginButton";
import UserMenu from "@/components/layout/navbar/UserMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS ??= {} as typeof CSS;
globalThis.CSS.escape ??= (value: string) => value;

let container: HTMLDivElement;
let root: Root;

function render(element: React.ReactNode) {
	act(() => {
		root.render(
			<NextIntlClientProvider locale="en-GB" messages={messages} timeZone="UTC">
				{element}
			</NextIntlClientProvider>,
		);
	});
}

function press(name: string) {
	const control = [...document.querySelectorAll("button, [role='menuitem']")].find(
		(element) => element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
	);
	if (!control) throw new Error(`No control named ${name}`);
	act(() => {
		control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

function menuText() {
	return [...document.querySelectorAll("[role='menuitem']")].map((item) => item.textContent?.trim());
}

const context = { session: null, styleVariant: "small" as const, theme: "light", setTheme: vi.fn() };

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	session.reader = null;
	session.features = { readerAccounts: true, themeSwitcher: true, languageSwitcher: false };
	session.signIn.mockReset();
	session.signOut.mockReset();
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	document.body.innerHTML = "";
});

describe("signing in from the header", () => {
	it("starts OpenScholar sign-in only when the reader presses Sign in", () => {
		render(<LoginButton variant="inline" styleVariant="small" />);
		expect(session.signIn).not.toHaveBeenCalled();
		press("Sign in");
		expect(session.signIn).toHaveBeenCalledTimes(1);
	});

	it("offers no sign-in when the library has reader accounts off", () => {
		session.features = { ...session.features, readerAccounts: false };
		render(
			<>
				<LoginButton variant="inline" styleVariant="small" />
				<ActionsDropdown context={context} />
			</>,
		);
		press("Actions menu");
		expect(menuText()).not.toContain("Sign in");
		expect(document.body.textContent).not.toContain("Sign in");
	});

	it("puts Sign in in the condensed menu for a signed-out reader", () => {
		render(<ActionsDropdown context={context} />);
		press("Actions menu");
		expect(menuText()).toContain("Sign in");
	});
});

describe("the signed-in reader's menu", () => {
	it("calls a reader without a name Reader, asks them to add one and signs them out", () => {
		session.reader = { id: "reader-amina", name: "", image: null };
		render(<UserMenu variant="inline" styleVariant="small" />);
		press("Your account");
		const items = menuText().join(" | ");
		expect(items).toContain("Reader");
		expect(items).toContain("Add your name");
		expect(items).toContain("Signed in with OpenScholar");
		press("Sign out");
		expect(session.signOut).toHaveBeenCalledTimes(1);
	});

	it("offers no profile to an admin of a library with reader accounts off", () => {
		session.features = { ...session.features, readerAccounts: false };
		session.reader = { id: "reader-amina", name: "Amina Okafor", image: null };
		render(<UserMenu variant="inline" styleVariant="small" />);
		press("Your account");
		expect(menuText()).not.toContain("Profile");
		expect(menuText()).toContain("Sign out");
	});

	it("shows a named reader their name and no prompt to add one", () => {
		session.reader = { id: "reader-amina", name: "Amina Okafor", image: null };
		render(<UserMenu variant="inline" styleVariant="small" />);
		press("Your account");
		const items = menuText().join(" | ");
		expect(items).toContain("Amina Okafor");
		expect(items).not.toContain("Add your name");
	});
});
