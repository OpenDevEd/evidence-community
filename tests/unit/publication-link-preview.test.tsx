// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import messages from "@/messages/en-GB.json";

// The library's real public configuration, from the fixture every configuration test uses.
vi.mock("@/context/LibraryConfigProvider", async () => {
	const { libraryConfigSchema } = await import("@/config/library-config/schema");
	const { projectPublicLibraryConfig } = await import("@/config/library-config/public");
	const { maximalLibraryConfig } = await import("../fixtures/library-config");
	const config = projectPublicLibraryConfig(libraryConfigSchema.parse(maximalLibraryConfig));
	return { useLibraryConfig: () => config };
});

vi.mock("@/lib/utils", async (original) => ({ ...(await original<typeof import("@/lib/utils")>()), fetcher: vi.fn(async () => ({ item: ITEM })) }));

import { PublicationLinkPreview } from "@/components/features/markdown/Citation";

const ITEM = { key: "ABCD2345", title: "Parks and heat in Nairobi", creators: [{ name: "Ada Mills", creatorType: "author" }], date: "2026-10-01", abstractNote: "Parks cooled their surroundings.", itemType: "JournalArticle", tags: [] };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("opens the publication in a new tab from anywhere on its card, and keeps the copy button a control of its own", async () => {
	await act(async () => root.render(
		<NextIntlClientProvider locale="en-GB" timeZone="UTC" messages={messages}>
			<SWRConfig value={{ provider: () => new Map() }}>
				<PublicationLinkPreview itemKey="ABCD2345" href="/lib/ABCD2345" />
			</SWRConfig>
		</NextIntlClientProvider>,
	));
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
	const link = container.querySelector<HTMLAnchorElement>('a[href$="/lib/ABCD2345"]');
	expect(link).not.toBeNull();
	expect(link!.target).toBe("_blank");
	expect(link!.getAttribute("aria-label")).toBe("Parks and heat in Nairobi");
	// The link is the card's own layer; the copy button is not inside it.
	expect(link!.querySelector("button")).toBeNull();
	expect(container.querySelector("button")).not.toBeNull();
	expect(container.textContent).toContain("Parks and heat in Nairobi");
});
