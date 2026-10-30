// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
	useFormatter: () => ({ number: (value: number) => String(value) }),
}));
vi.mock("@/context/FiltersProvider", () => ({
	useFiltersContext: () => ({ facetTotals: undefined }),
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: () => false,
}));
vi.mock("@/components/nextui/Input", () => ({
	Input: ({
		label,
		defaultValue,
		onChange,
	}: {
		label: string;
		defaultValue: string;
		onChange: React.ChangeEventHandler<HTMLInputElement>;
	}) => <input aria-label={label} defaultValue={defaultValue} onChange={onChange} />,
}));
vi.mock("@/components/nextui/Switch", () => ({
	Switch: ({
		children,
		isSelected,
		onValueChange,
	}: {
		children: React.ReactNode;
		isSelected: boolean;
		onValueChange: (selected: boolean) => void;
	}) => (
		<label>
			{children}
			<input
				type="checkbox"
				role="switch"
				checked={isSelected}
				onChange={(event) => onValueChange(event.target.checked)}
			/>
		</label>
	),
}));
vi.mock("framer-motion", () => ({
	AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
	useIsPresent: () => true,
	motion: {
		div: ({
			children,
			initial: _initial,
			animate: _animate,
			exit: _exit,
			layout: _layout,
			...props
		}: React.HTMLAttributes<HTMLDivElement> & {
			initial?: unknown;
			animate?: unknown;
			exit?: unknown;
			layout?: unknown;
		}) => <div {...props}>{children}</div>,
	},
}));

import { YearFilter } from "@/components/features/collections/YearFilter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("the publication year filter", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function render({
		range = "",
		onRangeChange = vi.fn(),
	}: {
		range?: string;
		onRangeChange?: (start: string | null, end: string | null) => void;
	} = {}) {
		await act(async () => {
			root.render(
				<YearFilter
					range={range}
					onRangeChange={onRangeChange}
					years={[]}
				/>,
			);
		});
	}

	const box = (label: string) =>
		container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);

	async function type(label: string, value: string) {
		const input = box(label);
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	async function toggle() {
		const control = container.querySelector<HTMLInputElement>(
			'input[role="switch"]',
		);
		await act(async () => {
			control?.click();
		});
	}

	it("switches between one year and a year range before a year is selected", async () => {
		const onRangeChange = vi.fn();
		await render({ onRangeChange });

		expect(container.querySelector('[aria-label="year"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="from"]')).toBeNull();

		await toggle();

		expect(container.querySelector('[aria-label="year"]')).toBeNull();
		expect(container.querySelector('[aria-label="from"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="to"]')).not.toBeNull();
		expect(onRangeChange).not.toHaveBeenCalled();

		await toggle();

		expect(container.querySelector('[aria-label="year"]')).not.toBeNull();
		expect(onRangeChange).toHaveBeenCalledWith("", null);
	});

	it("keeps the mode and query in sync when the range changes", async () => {
		const onRangeChange = vi.fn();
		await render({ range: "2010", onRangeChange });

		await toggle();

		expect(onRangeChange).toHaveBeenCalledWith("2010", "");

		await render({ range: "2010-2020", onRangeChange });
		expect(container.querySelector('[aria-label="from"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="to"]')).not.toBeNull();

		await render({ range: "", onRangeChange });
		expect(container.querySelector('[aria-label="year"]')).not.toBeNull();
	});

	it("keeps Year Range on when a cleared Year is switched to a range", async () => {
		const onRangeChange = vi.fn();
		await render({ range: "2020", onRangeChange });

		await type("year", "");
		await toggle();
		expect(onRangeChange).toHaveBeenLastCalledWith("", null);

		await render({ range: "", onRangeChange });
		expect(container.querySelector('[aria-label="from"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="to"]')).not.toBeNull();
	});

	it("turns Year Range on for a range typed into the Year box", async () => {
		vi.useFakeTimers();
		const onRangeChange = vi.fn();
		await render({ onRangeChange });

		await type("year", "2020-2024");
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
		expect(onRangeChange).toHaveBeenCalledWith("2020-2024", null);

		await render({ range: "2020-2024", onRangeChange });
		expect(container.querySelector<HTMLInputElement>('input[role="switch"]')?.checked).toBe(true);
		expect(box("from")?.value).toBe("2020");
		expect(box("to")?.value).toBe("2024");
	});

	it("drops a typed year that is still waiting when the range changes elsewhere, even back to the same range", async () => {
		vi.useFakeTimers();
		const onRangeChange = vi.fn();
		await render({ range: "2020-2024", onRangeChange });

		await type("from", "2021");
		await render({ range: "", onRangeChange });
		expect(box("year")?.value).toBe("");
		await render({ range: "2020-2024", onRangeChange });
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(onRangeChange).not.toHaveBeenCalled();
		expect(box("from")?.value).toBe("2020");
	});

	it("keeps the focus in a box once its typed year applies", async () => {
		vi.useFakeTimers();
		const onRangeChange = vi.fn();
		await render({ range: "2020-", onRangeChange });

		box("to")?.focus();
		await type("to", "2024");
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
		expect(onRangeChange).toHaveBeenCalledWith("2020", "2024");

		await render({ range: "2020-2024", onRangeChange });
		expect(document.activeElement).toBe(box("to"));
		expect(box("to")?.value).toBe("2024");
	});
});
