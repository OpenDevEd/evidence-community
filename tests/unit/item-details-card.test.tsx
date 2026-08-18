// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@/app/api/item/types";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
	default: () => ({ auth: vi.fn(), handlers: {} }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next-intl", () => ({
	useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
	useTranslations: () => (key: string) => key,
}));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		identity: { baseUrl: "https://library.example.org" },
	}),
	useLibraryFeature: () => false,
}));

import {
	ItemDetails,
	LoadingContext,
} from "@/components/features/newlib/ItemPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("Publication Details card", () => {
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

	it("does not appear when the record has no publication details", async () => {
		await act(async () => {
			root.render(
				<LoadingContext.Provider value={{ loading: false }}>
					<ItemDetails
						item={
							{
								itemType: "Report",
								key: "REPORT01",
								title: "A report with no extra details",
								url: "https://library.example.org/lib/REPORT01",
							} as Item
						}
					/>
				</LoadingContext.Provider>,
			);
		});

		expect(container.textContent).not.toContain(
			"itemPublicationDetailsTitle",
		);
	});
});
