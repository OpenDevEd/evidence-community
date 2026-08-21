import { describe, expect, it } from "vitest";

import { rebaseNativeItemDraftPayload } from "@/lib/admin/item-draft-rebase";

describe("item draft rebase", () => {
	it("updates Language without creating a second name for the same field", () => {
		const validated = rebaseNativeItemDraftPayload({
			currentPayload: { itemType: "Report", language: "jp" },
			expectedPayload: { itemType: "Report", language: "jp" },
			payload: { itemType: "Report", language: "arabic" },
		});

		expect(validated.payload).toMatchObject({
			itemType: "Report",
			languageName: "arabic",
		});
		expect(validated.payload).not.toHaveProperty("language");
	});
});

describe("concurrent draft edits", () => {
	const base = {
		itemType: "Report",
		title: "Old title",
		abstractNote: "Old abstract",
		url: "https://example.org/old",
	};

	it("keeps both editors' changes when they touched different fields", async () => {
		const { mergeConcurrentDraftEdits } = await import(
			"@/lib/admin/item-draft-rebase"
		);
		const result = mergeConcurrentDraftEdits({
			// Another tab already saved a new abstract.
			currentPayload: { ...base, abstractNote: "New abstract" },
			// This tab loaded the record before that save.
			expectedPayload: base,
			// This tab changed only the title.
			payload: { ...base, title: "New title" },
		});
		expect(result.kind).toBe("merged");
		if (result.kind !== "merged") return;
		expect(result.payload).toMatchObject({
			title: "New title",
			abstractNote: "New abstract",
		});
	});

	it("reports a conflict when both tabs changed the same field to different values", async () => {
		const { mergeConcurrentDraftEdits } = await import(
			"@/lib/admin/item-draft-rebase"
		);
		const result = mergeConcurrentDraftEdits({
			currentPayload: { ...base, title: "Their title" },
			expectedPayload: base,
			payload: { ...base, title: "My title" },
		});
		expect(result).toEqual({ kind: "conflict", fields: ["title"] });
	});

	it("does not report a conflict when both tabs made the same change", async () => {
		const { mergeConcurrentDraftEdits } = await import(
			"@/lib/admin/item-draft-rebase"
		);
		const result = mergeConcurrentDraftEdits({
			currentPayload: { ...base, title: "Same title" },
			expectedPayload: base,
			payload: { ...base, title: "Same title" },
		});
		expect(result.kind).toBe("merged");
	});

	it("reports a conflict when another tab removed a field this tab edited", async () => {
		const { mergeConcurrentDraftEdits } = await import(
			"@/lib/admin/item-draft-rebase"
		);
		const { url: _removed, ...withoutUrl } = base;
		const result = mergeConcurrentDraftEdits({
			currentPayload: withoutUrl,
			expectedPayload: base,
			payload: { ...base, url: "https://example.org/new" },
		});
		expect(result).toEqual({ kind: "conflict", fields: ["url"] });
	});
});
