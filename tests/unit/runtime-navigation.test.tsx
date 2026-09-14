// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minimalLibraryConfig } from "../fixtures/library-config";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { Link, useRouter } from "@/i18n/routing";
import type { PlatformLocale } from "@/i18n/runtime";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
	useRouter: () => navigation,
	usePathname: () => "/lib",
	redirect: vi.fn(),
	permanentRedirect: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function NavigationControls() {
	const router = useRouter();
	return <>
		<Link href="/lib?author=Journal#results" prefetch={false}>Journal</Link>
		<button onClick={() => router.push("/lib?author=Journal#results")}>Filter</button>
	</>;
}

describe("runtime library navigation", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it.each<[PlatformLocale, PlatformLocale, string]>([
		["en-GB", "en-GB", "/lib?author=Journal#results"],
		["fr", "fr", "/lib?author=Journal#results"],
		["fr", "en-GB", "/en-GB/lib?author=Journal#results"],
		["en-GB", "fr", "/fr/lib?author=Journal#results"],
	])("uses canonical links and router targets with default %s and locale %s", async (defaultLocale, locale, href) => {
		const config = projectPublicLibraryConfig(libraryConfigSchema.parse({
			...minimalLibraryConfig,
			localization: { locales: ["en-GB", "fr"], defaultLocale, localePriority: [defaultLocale] },
		}));
		await act(async () => root.render(
			<LibraryConfigProvider config={config}>
				<NextIntlClientProvider locale={locale} messages={{}} timeZone="UTC">
					<NavigationControls />
				</NextIntlClientProvider>
			</LibraryConfigProvider>,
		));
		expect(container.querySelector("a")?.getAttribute("href")).toBe(href);
		await act(async () => container.querySelector("button")!.click());
		expect(navigation.push).toHaveBeenCalledWith(href);
	});
});
