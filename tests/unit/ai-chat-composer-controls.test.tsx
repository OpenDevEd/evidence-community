// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { ChatComposerControls } from "@/components/features/ai/ChatComposerControls";
import type { ChatMode } from "@/types/ai";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

type Overrides = Partial<Parameters<typeof ChatComposerControls>[0]>;

describe("the controls under the message box", () => {
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

	async function render(overrides: Overrides = {}) {
		await act(async () => {
			root.render(
				<ChatComposerControls
					canScreen
					isDeepResearchEnabled
					isInputReady
					isScreening={false}
					isWaiting={false}
					mode={"quick" as ChatMode}
					onModeChange={vi.fn()}
					onScreen={vi.fn()}
					onScreeningSettings={vi.fn()}
					prefersReducedMotion={false}
					screeningTooltip="Screen 3 answers"
					{...overrides}
				/>,
			);
		});
	}

	function button(label: string) {
		return container.querySelector<HTMLButtonElement>(
			`button[aria-label="${label}"]`,
		);
	}

	async function press(element: HTMLButtonElement | null) {
		await act(async () => {
			element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	it("hides research mode when the library has not turned it on", async () => {
		await render({ isDeepResearchEnabled: false });

		expect(button("researchMode")).toBeNull();
	});

	it("turns research mode on and off again", async () => {
		const onModeChange = vi.fn();
		await render({ mode: "quick" as ChatMode, onModeChange });

		const toggle = button("researchMode");
		expect(toggle?.getAttribute("aria-pressed")).toBe("false");
		await press(toggle);
		expect(onModeChange).toHaveBeenCalledWith("research");

		await render({ mode: "research" as ChatMode, onModeChange });
		expect(button("researchMode")?.getAttribute("aria-pressed")).toBe(
			"true",
		);
		await press(button("researchMode"));
		expect(onModeChange).toHaveBeenLastCalledWith("quick");
	});

	it("only offers screening when there is something to screen", async () => {
		await render({ canScreen: false });
		expect(button("smartScreening")?.disabled).toBe(true);

		const onScreen = vi.fn();
		await render({ canScreen: true, onScreen });
		await press(button("smartScreening"));
		expect(onScreen).toHaveBeenCalledOnce();
	});

	it("refuses to screen or send while an answer is still coming", async () => {
		const onScreen = vi.fn();
		await render({ isWaiting: true, onScreen });

		expect(button("smartScreening")?.disabled).toBe(true);
		expect(button("sendMessageAriaLabel")?.disabled).toBe(true);
		await press(button("smartScreening"));
		expect(onScreen).not.toHaveBeenCalled();
	});

	it("locks both screening buttons while a run is going", async () => {
		await render({ isScreening: true });

		expect(button("smartScreening")?.disabled).toBe(true);
		expect(button("smartScreening settings")?.disabled).toBe(true);
	});

	it("sends with the Enter key, and says so", async () => {
		await render();

		const send = button("sendMessageAriaLabel");
		expect(send?.getAttribute("type")).toBe("submit");
		expect(send?.getAttribute("aria-keyshortcuts")).toBe("Enter");
	});
});
