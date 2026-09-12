// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PublicationArchiveFiles } from "@/components/admin/PublicationArchiveFiles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("does not offer an empty attachment action in a frozen version but allows it in the working draft", async () => {
	const container = document.createElement("div");
	const attachments = document.createElement("section");
	attachments.id = "admin-attachments";
	attachments.scrollIntoView = vi.fn();
	document.body.append(container, attachments);
	const root = createRoot(container);
	try {
		await act(async () => root.render(<PublicationArchiveFiles attachments={[]} readOnly />));
		const frozenAction = container.querySelector("button")!;
		expect(frozenAction.disabled).toBe(true);
		await act(async () => frozenAction.click());
		expect(attachments.scrollIntoView).not.toHaveBeenCalled();

		await act(async () => root.render(<PublicationArchiveFiles attachments={[]} readOnly={false} />));
		const draftAction = container.querySelector("button")!;
		expect(draftAction.disabled).toBe(false);
		await act(async () => draftAction.click());
		expect(attachments.scrollIntoView).toHaveBeenCalledOnce();
	} finally {
		await act(async () => root.unmount());
		container.remove();
		attachments.remove();
	}
});
