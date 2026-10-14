// @vitest-environment jsdom

import { act, Activity } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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
					trailing={(ask) => (
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

	// Open in OpenScholar pressed while the search still waits sends what was typed (ResourcesView reads it).
	it("says what it holds while its search waits, and searches at once on Enter", async () => {
		const handleSearchChange = vi.fn();
		const onTyped = vi.fn();
		await act(async () => {
			root.render(
				<SearchBar
					handleSearchChange={handleSearchChange}
					onTyped={onTyped}
					search=""
				/>,
			);
		});

		await type("teacher training");
		expect(onTyped).toHaveBeenLastCalledWith("teacher training");
		expect(handleSearchChange).not.toHaveBeenCalled();

		await act(async () => {
			field().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(handleSearchChange).toHaveBeenCalledWith("teacher training");
		expect(onTyped).toHaveBeenLastCalledWith(null);
	});

	// A result followed straight after typing: the waiting search must not write the next page's address, nor stay
	// behind as what Open in OpenScholar sends. A page kept for Back (hidden, not unmounted) shows its search again.
	it("drops a waiting search and what it held when the field goes away", async () => {
		vi.useFakeTimers();
		try {
			const handleSearchChange = vi.fn();
			const onTyped = vi.fn();
			const show = (mode: "visible" | "hidden") =>
				act(async () => {
					root.render(
						<Activity mode={mode}>
							<SearchBar
								handleSearchChange={handleSearchChange}
								onTyped={onTyped}
								search=""
							/>
						</Activity>,
					);
				});

			await show("visible");
			await type("teacher training");
			await show("hidden");
			await act(async () => {
				vi.advanceTimersByTime(1000);
			});
			await show("visible");

			expect(handleSearchChange).not.toHaveBeenCalled();
			expect(onTyped).toHaveBeenLastCalledWith(null);
			expect(field().value).toBe("");
		} finally {
			vi.useRealTimers();
		}
	});

	// A result followed straight after typing leaves the page: the waiting search must not write this page's address
	// under that navigation. A link opened in another tab leaves this page where it is, and its search runs.
	it("drops a waiting search when a link is followed in this tab, and keeps it for another tab", async () => {
		vi.useFakeTimers();
		try {
			const handleSearchChange = vi.fn();
			await act(async () => {
				root.render(
					<>
						<SearchBar handleSearchChange={handleSearchChange} search="" />
						<a href="https://library.example/lib/RECORD" onClick={(event) => event.preventDefault()}>
							record
						</a>
					</>,
				);
			});
			const follow = (keys: MouseEventInit) =>
				act(async () => {
					container
						.querySelector("a")
						?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...keys }));
					vi.advanceTimersByTime(1000);
				});

			await type("teacher training");
			await follow({ metaKey: true });
			expect(handleSearchChange).toHaveBeenLastCalledWith("teacher training");

			await type("school meals");
			await follow({});
			expect(handleSearchChange).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	// The server draws the field before the page is interactive, and a reader can type into it then. Those words stay
	// once React takes the page over and draws it again, and they wait to be searched like any typing.
	it("keeps words typed before the page was interactive", async () => {
		const handleSearchChange = vi.fn();
		const onTyped = vi.fn();
		const bar = <SearchBar handleSearchChange={handleSearchChange} onTyped={onTyped} search="" />;
		container.innerHTML = renderToString(bar);
		field().value = "teacher training";

		await act(async () => {
			root = hydrateRoot(container, bar);
		});
		await act(async () => {
			root.render(<SearchBar handleSearchChange={handleSearchChange} onTyped={onTyped} search="" />);
		});

		expect(field().value).toBe("teacher training");
		expect(onTyped).toHaveBeenLastCalledWith("teacher training");
	});

	it("draws its trailing control", async () => {
		await act(async () => {
			root.render(
				<SearchBar
					handleSearchChange={vi.fn()}
					search=""
					trailing={() => <span data-testid="live">seen</span>}
				/>,
			);
		});

		await type("school meals");

		expect(
			container.querySelector('[data-testid="live"]')?.textContent,
		).toBe("seen");
	});
});
