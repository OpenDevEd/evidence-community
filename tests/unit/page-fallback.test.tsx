// @vitest-environment jsdom

import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("@/i18n/routing", () => ({ usePathname: () => path.current }));

import PageFallback from "@/components/pages/PageFallback";

let root: Root | undefined;
afterEach(() => act(() => root?.unmount()));

async function standIn(pathname: string) {
	path.current = pathname;
	const host = document.createElement("div");
	root = createRoot(host);
	await act(async () => root!.render(<Suspense fallback={null}><PageFallback contactForm={false} home={null} /></Suspense>));
	// The stand-in's code loads on first use, as the page's own does.
	await vi.waitFor(async () => { await act(async () => {}); if (!host.innerHTML && !pathname.startsWith("/admin")) throw new Error("still loading"); }, { timeout: 5000 });
	return host;
}

describe("page stand-in", () => {
	// A page nobody gave a stand-in of its own once left the area empty while it loaded, the footer against the header.
	it.each(["/a-page-added-later", "/evidence", "/profile"])("draws something on %s while the page loads", async (pathname) => {
		expect((await standIn(pathname)).querySelector("main")).not.toBeNull();
	});

	it("leaves the admin to its own loading state", async () => {
		expect((await standIn("/admin")).innerHTML).toBe("");
	});
});
