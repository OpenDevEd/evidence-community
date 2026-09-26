// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TruncatedText } from "@/components/nextui/TruncatedText";

describe("TruncatedText over two lines", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		Reflect.deleteProperty(document, "fonts");
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// jsdom has no layout, so the text's box is given sizes by hand.
	async function renderWithHeight(scrollHeight: number) {
		vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
		vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
		await act(async () => root.render(<TruncatedText text="A long collection name" lines={2} focusable />));
		return container.querySelector<HTMLElement>("[data-truncated-text]")!;
	}

	it("lets keyboard users reach the full text once it runs past two lines", async () => {
		expect((await renderWithHeight(60)).getAttribute("tabindex")).toBe("0");
	});

	it("stays out of the tab order while the text fits", async () => {
		expect((await renderWithHeight(40)).hasAttribute("tabindex")).toBe(false);
	});
});
