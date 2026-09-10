// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		ai: {
			providers: [
				{
					provider: "openrouter",
					enabled: true,
					models: [
						"openai/gpt-5.6-luna",
						"x-ai/grok-4.6",
						"google/gemini-3.8-flash",
					],
					defaultModel: "openai/gpt-5.6-luna",
					modelMetadata: {
						"google/gemini-3.8-flash": {name: "Gemini 3.8 Flash", company: "Google"},
					},
				},
			],
		},
	}),
}));

import ModelSelector from "@/components/features/ai/ModelSelector";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS ??= {} as typeof CSS;
globalThis.CSS.escape ??= (value: string) => value;

describe("the AI model picker", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		document.body.replaceChildren();
	});

	async function pressText(text: string) {
		const element = [
			...document.body.querySelectorAll("button, [role=option]"),
		].find((candidate) => candidate.textContent?.includes(text));
		if (!element) throw new Error(`Could not find ${text}`);

		await act(async () => {
			element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	it("warns before a model change removes an active conversation", async () => {
		const onModelChange = vi.fn();
		const onResetConversation = vi.fn();

		await act(async () => {
			root.render(
				<ModelSelector
					isOpen
					onOpenChange={vi.fn()}
					selectedModelId="openai/gpt-5.6-luna"
					onModelChange={onModelChange}
					hasConversation
					onResetConversation={onResetConversation}
				/>,
			);
		});

		await pressText("Gemini 3.8 Flash");

		expect(document.body.textContent).toContain("changeModelWarning");
		expect(onModelChange).not.toHaveBeenCalled();
		expect(onResetConversation).not.toHaveBeenCalled();

		await pressText("changeAndReset");

		expect(onResetConversation).toHaveBeenCalledOnce();
		expect(onModelChange).toHaveBeenCalledWith("google/gemini-3.8-flash");
	});
});
