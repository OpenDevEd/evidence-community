// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CollectionsSetting } from "@/components/admin/ImportAdd";
import type { ImportFlowState } from "@/components/admin/import-flow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flow = {
	busy: false,
	collections: [],
	locked: false,
	setCollections: vi.fn(),
	sources: [],
} as unknown as ImportFlowState;

let container: HTMLDivElement;
let root: Root;

function setPointer(fine: boolean) {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: fine && query.includes("pointer: fine"),
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
	}));
}

async function openCollections() {
	await act(async () => root.render(<NextUIProvider disableAnimation><CollectionsSetting flow={flow} /></NextUIProvider>));
	const search = () => container.querySelector('input[aria-label="Search collections"]');
	expect(search()).toBeNull();
	const setting = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
	await act(async () => setting.click());
	await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
	return search();
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hasMore: false, items: [], nextCursor: null })));
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

it("moves focus to the collection search when the editor opens the setting on a fine pointer", async () => {
	setPointer(true);
	const search = await openCollections();
	expect(search).not.toBeNull();
	expect(document.activeElement).toBe(search);
});

it("leaves focus alone on a touch screen, where focus would open the keyboard", async () => {
	setPointer(false);
	const search = await openCollections();
	expect(search).not.toBeNull();
	expect(document.activeElement).not.toBe(search);
});
