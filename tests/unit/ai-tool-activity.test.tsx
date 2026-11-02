// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it } from "vitest";

import { ToolActivity } from "@/components/features/ai/ToolActivity";
import type { ResearchToolPart } from "@/lib/ai/tool-activity";
import messages from "@/messages/en-US.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

function searchPart(overrides: Record<string, unknown> = {}) {
	return {
		type: "tool-searchLibrary",
		toolCallId: "call-1",
		state: "output-available",
		input: { queries: ["radio teaching", "school broadcasts"] },
		output: {
			queries: [
				{ query: "radio teaching", hits: [{ key: "A" }, { key: "B" }] },
				{ query: "school broadcasts", hits: [{ key: "C" }] },
			],
		},
		...overrides,
	} as unknown as ResearchToolPart;
}

describe("what the reader sees the assistant doing", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	async function render(part: ResearchToolPart) {
		await act(async () => {
			root.render(<NextIntlClientProvider locale="en-US" messages={messages}><ToolActivity part={part} /></NextIntlClientProvider>);
		});
	}

	async function openDetails() {
		const trigger = container.querySelector("button");
		await act(async () => {
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	it("names the step and its outcome before anything is expanded", async () => {
		await render(searchPart());

		expect(container.textContent).toContain("Library search");
		expect(container.textContent).toContain("Completed");
	});

	it("shows which searches ran and how much they found", async () => {
		await render(searchPart());
		await openDetails();

		expect(container.textContent).toContain("radio teaching");
		expect(container.textContent).toContain("school broadcasts");
		expect(container.textContent).toContain("3 results across 2 queries");
	});

	it("says when a search is still running", async () => {
		await render(
			searchPart({ state: "input-available", output: undefined }),
		);

		expect(container.textContent).toContain("Running");
	});

	it("says when the reader's own results were read, and which part", async () => {
		await render(
			searchPart({
				input: { queries: [], withinCurrentResults: true },
				output: {
					queries: [],
					currentResults: { start: 1, end: 200, total: 483 },
				},
			}),
		);
		await openDetails();

		expect(container.textContent).toContain("Read current results");
		expect(container.textContent).toContain("1–200 of 483");
		expect(container.textContent).toContain("200 entries in displayed order");
	});

	it("links each publication the assistant opened", async () => {
		await render(
			searchPart({
				type: "tool-readPublications",
				input: { itemKeys: ["ABCD1234"] },
				output: {},
			}),
		);
		await openDetails();

		expect(container.textContent).toContain("Reading publications");
		expect(
			container.querySelector('a[href="/lib/ABCD1234"]'),
		).not.toBeNull();
	});

	it("shows the reason a step failed", async () => {
		await render(
			searchPart({
				state: "output-error",
				errorText: "The current library search changed.",
				output: undefined,
			}),
		);
		await openDetails();

		expect(container.textContent).toContain("Failed");
		expect(container.textContent).toContain(
			"The current library search changed.",
		);
	});
});
