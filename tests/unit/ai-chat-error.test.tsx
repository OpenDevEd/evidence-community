// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { ChatErrorCard } from "@/components/features/ai/chat-shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("what the reader sees when a chat fails", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	async function render(props: {
		message: string;
		isContextTooLarge: boolean;
		onReset: () => void;
		onRetry: () => void;
	}) {
		await act(async () => {
			root.render(<ChatErrorCard {...props} />);
		});
	}

	async function pressAction() {
		const button = container.querySelector("button");
		await act(async () => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	it("shows the reason and offers another try", async () => {
		const onRetry = vi.fn();
		const onReset = vi.fn();
		await render({
			message: "The AI provider could not complete this request.",
			isContextTooLarge: false,
			onReset,
			onRetry,
		});

		expect(container.querySelector('[role="alert"]')).not.toBeNull();
		expect(container.textContent).toContain(
			"The AI provider could not complete this request.",
		);

		await pressAction();
		expect(onRetry).toHaveBeenCalledOnce();
		expect(onReset).not.toHaveBeenCalled();
	});

	it("offers a reset instead when the conversation is too long", async () => {
		const onRetry = vi.fn();
		const onReset = vi.fn();
		await render({
			message: "This conversation is too long for the selected model.",
			isContextTooLarge: true,
			onReset,
			onRetry,
		});

		await pressAction();
		expect(onReset).toHaveBeenCalledOnce();
		expect(onRetry).not.toHaveBeenCalled();
	});
});
