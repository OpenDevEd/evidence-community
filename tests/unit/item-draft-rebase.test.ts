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
