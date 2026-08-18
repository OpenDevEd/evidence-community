// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	getAdminItems: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/admin-api", () => ({
	getAdminItems: api.getAdminItems,
}));

import { AdminItemPicker } from "@/components/admin/AdminItemPicker";

const rows = [
	{ itemType: "Book", key: "SELF2345", state: "published", title: "Myself" },
	{ itemType: "Book", key: "LNKD2345", state: "published", title: "Already linked" },
	{ itemType: "Report", key: "FREE2345", state: "edited", title: "Free record" },
];

describe("AdminItemPicker", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		api.getAdminItems.mockResolvedValue({ hasMore: false, items: rows, nextCursor: null });
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	function input() {
		return container.querySelector<HTMLInputElement>('input[aria-label="Search records to link"]')!;
	}

	async function typeQuery(value: string) {
		const field = input();
		const setter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)!.set!;
		await act(async () => {
			setter.call(field, value);
			field.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(300);
		});
	}

	it("shows a hint until the editor types, then lists only pickable records", async () => {
		const onPick = vi.fn();
		await act(async () => {
			root.render(
				<AdminItemPicker
					excludeKeys={["LNKD2345"]}
					onPick={onPick}
					selfKey="SELF2345"
				/>,
			);
		});
		expect(container.textContent).toContain("Type to search the library.");
		expect(api.getAdminItems).not.toHaveBeenCalled();

		await typeQuery("rec");
		expect(api.getAdminItems).toHaveBeenCalledTimes(1);
		const params = api.getAdminItems.mock.calls[0]![0] as URLSearchParams;
		expect(params.get("search")).toBe("rec");
		expect(JSON.parse(params.get("filters")!)).toEqual([
			{ column: "state", operator: "anyOf", value: ["published", "edited"] },
		]);
		const options = [...container.querySelectorAll('[role="option"]')].map(
			(node) => node.querySelector("button")!.getAttribute("data-admin-picker-key"),
		);
		expect(options).toEqual(["FREE2345"]);
	});

	it("picks the highlighted record with Enter", async () => {
		const onPick = vi.fn();
		await act(async () => {
			root.render(
				<AdminItemPicker excludeKeys={[]} onPick={onPick} selfKey="SELF2345" />,
			);
		});
		await typeQuery("free");
		await act(async () => {
			input().dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			);
		});
		expect(onPick).toHaveBeenCalledWith({
			deleted: false,
			itemType: "Book",
			key: "LNKD2345",
			title: "Already linked",
		});
	});
});
