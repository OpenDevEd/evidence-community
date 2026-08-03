import { describe, expect, it } from "vitest";

import {
	clearChangedAdminFieldErrors,
	firstAdminFieldError,
	shouldClearAdminValidationErrors,
	validationTargetId,
} from "@/components/admin/admin-validation";

describe("admin field validation", () => {
	it("clears only errors in the edited payload section", () => {
		const errors = {
			"creators.0": "Enter a creator name.",
			"creators.1.creatorType": "Choose a valid role.",
			title: "Enter a title.",
		};

		expect(
			clearChangedAdminFieldErrors(
				errors,
				{
					creators: [
						{ creatorType: "author", firstName: "", lastName: "" },
					],
					title: "",
				},
				{
					creators: [
						{
							creatorType: "author",
							firstName: "Ada",
							lastName: "",
						},
					],
					title: "",
				},
			),
		).toEqual({
			title: "Enter a title.",
		});
	});

	it("maps server field paths to stable inspector controls", () => {
		expect(validationTargetId("ABCD2345", "title")).toBe(
			"admin-ABCD2345-title",
		);
		expect(validationTargetId("ABCD2345", "creators.0")).toBe(
			"admin-creator-0",
		);
		expect(validationTargetId("ABCD2345", "creators.1.creatorType")).toBe(
			"admin-creator-1-role",
		);
		expect(validationTargetId("ABCD2345", "creators.1.firstName")).toBe(
			"admin-creator-1",
		);
		expect(validationTargetId("ABCD2345", "_form")).toBeNull();
		expect(validationTargetId("ABCD2345", "collections")).toBe(
			"admin-ABCD2345-collections",
		);
		expect(validationTargetId("ABCD2345", "collections.0")).toBe(
			"admin-ABCD2345-collections",
		);
		expect(validationTargetId("ABCD2345", "tags.0")).toBe(
			"admin-ABCD2345-tags",
		);
	});

	it("finds the first error for a field and its nested values", () => {
		const errors = {
			"collections.1": "Choose an available collection.",
			title: "Enter a title.",
			"tags.0": "Enter a valid tag.",
		};

		expect(firstAdminFieldError(errors, "collections")).toBe(
			"Choose an available collection.",
		);
		expect(firstAdminFieldError(errors, "tags")).toBe("Enter a valid tag.");
		expect(firstAdminFieldError(errors, "creators")).toBeUndefined();
	});

	it("keeps validation errors across refreshes of the same payload", () => {
		const payload = { creators: [], title: "Draft" };
		expect(
			shouldClearAdminValidationErrors({
				currentKey: "ABCD2345",
				currentPayload: payload,
				nextKey: "ABCD2345",
				nextPayload: { creators: [], title: "Draft" },
				replaceLocal: false,
			}),
		).toBe(false);
		expect(
			shouldClearAdminValidationErrors({
				currentKey: "ABCD2345",
				currentPayload: payload,
				nextKey: "ABCD2345",
				nextPayload: { creators: [], title: "Changed elsewhere" },
				replaceLocal: false,
			}),
		).toBe(true);
		expect(
			shouldClearAdminValidationErrors({
				currentKey: "ABCD2345",
				currentPayload: payload,
				nextKey: "ABCD2345",
				nextPayload: payload,
				replaceLocal: true,
			}),
		).toBe(true);
	});

	it("ignores jsonb object-key reordering when comparing payloads", () => {
		expect(
			shouldClearAdminValidationErrors({
				currentKey: "ABCD2345",
				currentPayload: {
					creators: [{ creatorType: "author", name: "Ada" }],
					tags: [],
					title: "Draft",
					url: "https://example.org",
				},
				nextKey: "ABCD2345",
				nextPayload: {
					url: "https://example.org",
					tags: [],
					title: "Draft",
					creators: [{ name: "Ada", creatorType: "author" }],
				},
				replaceLocal: false,
			}),
		).toBe(false);
	});
});
