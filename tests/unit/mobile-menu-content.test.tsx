import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import MobileMenu from "@/components/layout/navbar/MobileMenu";
import { LibraryConfigProvider, useLibraryConfig } from "@/context/LibraryConfigProvider";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import type { NavbarElementConfig } from "@/types/navbar";
import messages from "@/messages/en-GB.json";
import { maximalLibraryConfig, minimalLibraryConfig } from "../fixtures/library-config";

vi.mock("@/lib/actions", () => ({areLinksValid: vi.fn()}));
vi.mock("@/i18n/routing", () => ({Link: ({onNavigate: _onNavigate, ...props}: ComponentProps<"a"> & {onNavigate?: () => void}) => <a {...props} />}));
vi.mock("@/context/Providers", () => ({useGapMaps: () => useLibraryConfig().gapMaps}));

function renderMenu({links = false, gapMaps = false, controls = false} = {}) {
	const config = projectPublicLibraryConfig(libraryConfigSchema.parse(minimalLibraryConfig));
	config.navigation.links = [{id: "library", label: "Library", href: "/lib", visible: links, target: "self", children: []}];
	config.gapMaps = gapMaps ? projectPublicLibraryConfig(libraryConfigSchema.parse(maximalLibraryConfig)).gapMaps : [];
	const elements: NavbarElementConfig[] = controls ? [{id: "theme-switcher", enabled: () => true, placement: {mobile: "mobileMenu", tablet: "dropdown", desktop: "inline"}, component: () => <button>Theme</button>}] : [];
	return renderToStaticMarkup(
		<NextIntlClientProvider locale="en-GB" messages={messages} timeZone="UTC">
			<LibraryConfigProvider config={config}>
				<MobileMenu elements={elements} pathname="/digests" context={{session: null, styleVariant: "small", theme: "light", setTheme: () => {}}} />
			</LibraryConfigProvider>
		</NextIntlClientProvider>,
	);
}

describe("mobile menu content", () => {
	it("has no empty opener when links and controls are disabled", () => {
		expect(renderMenu()).toBe("");
	});
	it("keeps a menu containing only a visible library link", () => {
		const html = renderMenu({links: true});
		expect(html).toContain('aria-label="Open hamburger menu"');
		expect(html).toContain('href="/lib"');
	});
	it("keeps the gap-map destination when configured links are hidden", () => {
		const html = renderMenu({gapMaps: true});
		expect(html).toContain('aria-label="Open hamburger menu"');
		expect(html).toContain('href="/gapmaps"');
	});
	it("keeps a menu containing only an enabled control", () => {
		const html = renderMenu({controls: true});
		expect(html).toContain('aria-label="Open hamburger menu"');
		expect(html).toContain('<button>Theme</button>');
	});
});
