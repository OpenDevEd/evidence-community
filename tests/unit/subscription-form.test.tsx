// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Subscription } from "@/components/digests/Subscription";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	fetchMock.mockReset();
	vi.unstubAllGlobals();
});
async function renderForm() {
	await act(async () => root.render(<NextUIProvider disableAnimation><Subscription preferences token={"a".repeat(64)} schedule="Monthly" initial={{email: "reader@example.org", digest: true, instant: true, confirmed: true}} /></NextUIProvider>));
}
function button(name: string) {
	const found = [...container.querySelectorAll("button")].find(element => element.textContent?.trim() === name);
	if (!found) throw new Error(`Missing ${name} button`);
	return found;
}
function digestSwitch() {
	const found = container.querySelector<HTMLInputElement>('input[name="digest"]');
	if (!found) throw new Error("Missing digest switch");
	return found;
}

it("changes the preference when its visible label is clicked", async () => {
	await renderForm();
	const label = [...container.querySelectorAll<HTMLElement>("*")].find(element => element.childNodes.length === 1 && element.textContent === "Library digests");
	if (!label) throw new Error("Missing Library digests label");
	await act(async () => label.click());
	expect(digestSwitch().checked).toBe(false);
	expect(fetchMock).not.toHaveBeenCalled();
});

it("locks preferences and unsubscribe while a save is pending, then permits retry", async () => {
	let rejectRequest!: (error: Error) => void;
	fetchMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
	await renderForm();
	await act(async () => button("Save preferences").click());
	expect(digestSwitch().disabled).toBe(true);
	expect(button("Unsubscribe from all").disabled).toBe(true);
	await act(async () => rejectRequest(new TypeError("wire-error")));
	expect(digestSwitch().disabled).toBe(false);
	expect(button("Save preferences").disabled).toBe(false);
	expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it.each(["offline", "proxy error"])("retains preferences after %s and clears the error on editing before retry", async failure => {
	if (failure === "offline") fetchMock.mockRejectedValueOnce(new TypeError("wire-error"));
	else fetchMock.mockResolvedValueOnce(new Response("<html>wire-error</html>", {status: 503}));
	fetchMock.mockResolvedValueOnce(Response.json({ok: true}));
	await renderForm();
	await act(async () => button("Save preferences").click());
	const alert = container.querySelector('[role="alert"]');
	expect(alert?.textContent).toMatch(/\S/u);
	expect(alert?.textContent).not.toContain("wire-error");
	expect(alert?.textContent).not.toContain("<html>");
	expect(digestSwitch().checked).toBe(true);
	await act(async () => digestSwitch().click());
	expect(container.querySelector('[role="alert"]')).toBeNull();
	await act(async () => button("Save preferences").click());
	const request = fetchMock.mock.calls.at(-1)!;
	expect(JSON.parse(String(request[1]?.body))).toEqual({action: "preferences", token: "a".repeat(64), digest: false, instant: true});
	expect(digestSwitch().checked).toBe(false);
	expect(container.querySelector('[role="status"]')?.textContent).toMatch(/\S/u);
});
