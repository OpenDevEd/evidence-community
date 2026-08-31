// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: () => false,
}));
vi.mock("@/components/nextui/Input", () => ({
	Input: ({ label }: { label: string }) => <input aria-label={label} />,
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
					key={range}
					range={range}
					onRangeChange={onRangeChange}
					years={[]}
				/>,
			);
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
});
