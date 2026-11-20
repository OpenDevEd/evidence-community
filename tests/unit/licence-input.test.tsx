// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextUIProvider } from "@nextui-org/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LicenceInput } from "@/components/admin/LicenceInput";
import type { RecordLicence } from "@/lib/licences";

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

async function pressUse(rights: string) {
	const onChange = vi.fn<(licence: RecordLicence) => void>();
	await act(async () => root.render(<NextUIProvider disableAnimation><LicenceInput value={null} rights={rights} defaultLicence="cc-by-4.0" needed={false} onChange={onChange} /></NextUIProvider>));
	const use = [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Use "))!;
	await act(async () => use.click());
	return onChange.mock.calls[0]?.[0];
}

// A record whose rights were edited to name CC BY-NC 4.0 offered the community's CC BY 4.0, a licence its rights refuse.
it("offers the licence a record's rights name before the community's default", async () => {
	expect(await pressUse("This work is licensed under CC BY-NC 4.0.")).toEqual({ kind: "zenodo", id: "cc-by-nc-4.0" });
	expect(await pressUse("© 2024 Ministry of Education. All rights reserved.")).toEqual({ kind: "zenodo", id: "other-closed" });
	expect(await pressUse("© 2024 Ministry of Education.")).toEqual({ kind: "zenodo", id: "cc-by-4.0" });
});
