// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

// The router only matters to the page around the field.
vi.mock("@/i18n/routing", () => ({ usePathname: () => "/lib" }));

import { SearchBar } from "@/components/features/SearchBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("asking the assistant from the search field", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	function field() {
		const input = container.querySelector("input");
		if (!input) throw new Error("the search field is missing");

		return input;
	}

	async function type(value: string) {
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(field(), value);
			field().dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	async function pressCmdEnter() {
		await act(async () => {
			field().dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					metaKey: true,
					bubbles: true,
				}),
			);
		});
	}

	it("hands over what was typed and empties the field", async () => {
		const onAsk = vi.fn((text: string, clear: () => void) => clear());
		const handleSearchChange = vi.fn();
		await act(async () => {
			root.render(
				<SearchBar
					handleSearchChange={handleSearchChange}
					search=""
					onAsk={onAsk}
				/>,
			);
		});

		await type("teacher training");
		await pressCmdEnter();

		expect(onAsk.mock.calls[0]?.[0]).toBe("teacher training");
		expect(field().value).toBe("");
		expect(handleSearchChange).toHaveBeenLastCalledWith("");
	});

	it("does nothing special for Enter on its own", async () => {
		const onAsk = vi.fn();
		await act(async () => {
			root.render(
				<SearchBar
					handleSearchChange={vi.fn()}
					search=""
					onAsk={onAsk}
				/>,
			);
		});

		await type("teacher training");
		await act(async () => {
			field().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(onAsk).not.toHaveBeenCalled();
		expect(field().value).toBe("teacher training");
	});

	// The button used to be handed the text as it was when the button was
	// drawn, which was stale by the time the reader pressed it.
	it("hands over what the field holds when a button asks", async () => {
		const onAsk = vi.fn((text: string, clear: () => void) => clear());
		await act(async () => {
			root.render(
				<SearchBar
					handleSearchChange={vi.fn()}
					search=""
					onAsk={onAsk}
					endContent={(_liveText, ask) => (
						<button type="button" data-testid="ask" onClick={ask}>
							Ask
						</button>
					)}
				/>,
			);
		});

		await type("teacher training");
		await act(async () => {
			container
				.querySelector('[data-testid="ask"]')
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(onAsk.mock.calls[0]?.[0]).toBe("teacher training");
		expect(field().value).toBe("");
	});

	it("shows the reader what the field holds right now", async () => {
		await act(async () => {
			root.render(
				<SearchBar
					handleSearchChange={vi.fn()}
					search=""
					endContent={(liveText) => (
						<span data-testid="live">{liveText}</span>
					)}
				/>,
			);
		});

		await type("school meals");

		expect(
			container.querySelector('[data-testid="live"]')?.textContent,
		).toBe("school meals");
	});
});
