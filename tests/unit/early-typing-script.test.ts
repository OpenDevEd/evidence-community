// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";

import { earlyTypingScript } from "@/app/_components/EarlyTypingScript";

// A page streams in after its placeholder, which draws the same search box; the swap happens before React runs.
describe("words typed before the page is interactive", () => {
	beforeAll(() => {
		new Function(earlyTypingScript)();
	});

	/** Draws the placeholder's box, types into it, then swaps in the streamed page's box (with `streamed` as its value). */
	async function typeThenSwap(typed: string, caret: number, streamed = "", after?: () => void) {
		document.body.innerHTML = `<main id="page"><div role="search"><input id="placeholder" value="${streamed}" /></div></main><button id="elsewhere">x</button>`;
		const box = document.getElementById("placeholder") as HTMLInputElement;
		box.focus();
		box.value = typed;
		box.setSelectionRange(caret, caret);
		box.dispatchEvent(new Event("input", { bubbles: true }));
		after?.();
		document.getElementById("page")?.remove();
		await Promise.resolve();
		document.body.insertAdjacentHTML("afterbegin", `<main><div role="search"><input id="streamed" value="${streamed}" /></div></main>`);
		await new Promise((resolve) => setTimeout(resolve, 0));
		return document.getElementById("streamed") as HTMLInputElement;
	}

	it("move with the focus and the caret into the box that replaces the one typed into", async () => {
		const box = await typeThenSwap("teacher training", 7);
		expect(box.value).toBe("teacher training");
		expect(document.activeElement).toBe(box);
		expect(box.selectionStart).toBe(7);
	});

	it("replace a search the page already had", async () => {
		const box = await typeThenSwap("French immersion", 16, "French");
		expect(box.value).toBe("French immersion");
	});

	it("leave the focus where the reader moved it", async () => {
		const box = await typeThenSwap("teacher", 7, "", () => document.getElementById("elsewhere")?.focus());
		expect(box.value).toBe("teacher");
		expect(document.activeElement?.id).toBe("elsewhere");
	});
});
