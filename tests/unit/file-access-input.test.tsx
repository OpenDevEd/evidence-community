// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileAccessInput } from "@/components/admin/FileAccessInput";
import type { FileAccess } from "@/lib/licences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

// The QA of 20 November typed 2020-01-01 as an embargo's day: the box kept it, nothing said it was refused, and the
// record published with the day saved before.
it("refuses a day before tomorrow at the field and keeps the saved day", async () => {
	const onChange = vi.fn<(access: FileAccess) => void>();
	await act(async () => root.render(<NextUIProvider disableAnimation><FileAccessInput licence={{ kind: "zenodo", id: "cc-by-4.0" }} value={{ mode: "embargo", until: "2099-06-01" }} onChange={onChange} /></NextUIProvider>));
	const box = () => container.querySelector<HTMLInputElement>('input[type="date"]')!;
	await act(async () => {
		box().focus();
		box().value = "2020-01-01";
		box().blur();
	});
	expect(onChange).not.toHaveBeenCalled();
	expect(box().value).toBe("2099-06-01");
	expect(box().getAttribute("aria-invalid")).toBe("true");

	await act(async () => {
		box().focus();
		box().value = "2099-07-01";
		box().blur();
	});
	expect(onChange).toHaveBeenCalledWith({ mode: "embargo", until: "2099-07-01" });
});
