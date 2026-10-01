// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en-GB.json";

const session = vi.hoisted(() => ({ reader: null as { id: string; name: string; image: string | null } | null }));
const list = vi.hoisted(() => ({ selected: "", select: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/i18n/routing", () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/layout/navbar/ReaderSession", () => ({
	useReaderSession: () => ({ reader: session.reader }),
	useOpenScholarAccountUrl: () => "https://accounts.openscholar.example.org/user",
}));
vi.mock("@/hooks/useReaderData", () => ({ useReaderData: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/useItemsList", () => ({
	useItemsList: () => ({ queryParams: { collectionId: list.selected }, handleCollectionSelect: list.select }),
}));
// The list itself is the library's; the profile around it is under test.
vi.mock("@/components/features/items/ItemsList", () => ({ default: () => null }));
vi.mock("swr", () => ({
	default: () => ({ data: { items: [] } }),
	useSWRConfig: () => ({ mutate: vi.fn() }),
}));

import ReaderProfile, { type ProfileData } from "@/components/pages/ReaderProfile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS ??= {} as typeof CSS;
globalThis.CSS.escape ??= (value: string) => value;

const TEACHER_TRAINING = "6b3a8f2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const profile: ProfileData = {
	id: "reader-amina",
	name: "Amina Okafor",
	image: null,
	bookmarks: { SAVED001: "2026-09-02T10:00:00.000Z", SAVED002: "2026-09-10T10:00:00.000Z" },
	collections: [
		{ id: TEACHER_TRAINING, name: "Teacher training", description: "For the review", private: true, count: 2, createdAt: "2026-09-03T10:00:00.000Z" },
	],
};

let container: HTMLDivElement;
let root: Root;

function render(data: ProfileData = profile) {
	act(() => {
		root.render(
			<NextIntlClientProvider locale="en-GB" messages={messages} timeZone="UTC">
				<ReaderProfile data={data} />
			</NextIntlClientProvider>,
		);
	});
}

function buttonNamed(name: string) {
	return [...document.querySelectorAll("button")].find(
		(button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name,
	);
}

function click(element: Element | undefined) {
	if (!element) throw new Error("Nothing to click");
	act(() => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	session.reader = null;
	list.selected = "";
	list.select.mockReset();
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

describe("a reader's profile", () => {
	it("gives a visitor nothing to edit", () => {
		session.reader = { id: "reader-bob", name: "Bob", image: null };
		render();

		expect(document.body.textContent).toContain("Amina Okafor");
		expect(document.body.textContent).toContain("Teacher training");
		expect(buttonNamed("Share profile")).toBeTruthy();
		expect(document.querySelector('a[href="https://accounts.openscholar.example.org/user"]')).toBeNull();
		expect(buttonNamed("New collection")).toBeUndefined();
	});

	it("sends the owner to OpenScholar to edit their profile and lets them add collections", () => {
		session.reader = { id: "reader-amina", name: "Amina Okafor", image: null };
		render();

		const editProfile = document.querySelector('a[href="https://accounts.openscholar.example.org/user"]');
		expect(editProfile?.textContent).toContain("Edit profile");
		expect(buttonNamed("New collection")).toBeTruthy();
	});

	it("calls a reader without a name Reader and asks them to add one", () => {
		session.reader = { id: "reader-amina", name: "", image: null };
		render({ ...profile, name: "" });

		expect(document.querySelector("h1")?.textContent).toBe("Reader");
		expect(document.querySelector('a[href="https://accounts.openscholar.example.org/user"]')?.textContent).toContain("Add your name");
	});

	it("saves and deletes the owner's collection through the reader API", async () => {
		session.reader = { id: "reader-amina", name: "Amina Okafor", image: null };
		list.selected = TEACHER_TRAINING;
		const requests: { url: string; method: string; body: unknown }[] = [];
		vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
			requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
			return new Response(null, { status: init?.method === "DELETE" ? 204 : 200 });
		}));
		render();

		expect(document.body.textContent).toContain("For the review");
		click(buttonNamed("Edit"));
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit collection");
		await act(async () => {
			document.querySelector('[role="dialog"] form')?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});
		expect(requests).toContainEqual({
			url: `/api/reader/collections/${TEACHER_TRAINING}`,
			method: "PATCH",
			body: { name: "Teacher training", description: "For the review", private: true },
		});

		click(buttonNamed("Edit"));
		click(buttonNamed("Delete"));
		const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Delete");
		await act(async () => {
			confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(requests).toContainEqual({ url: `/api/reader/collections/${TEACHER_TRAINING}`, method: "DELETE", body: null });
		expect(list.select).toHaveBeenCalledWith("");
	});
});
