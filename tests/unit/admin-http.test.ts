import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adminErrorResponse, readAdminJson } from "@/lib/admin/http";
import { NativeCollectionValidationError } from "@/lib/admin/native-collection-service";
import { NativeFileValidationError } from "@/lib/admin/native-file-service";
import {
	NativeItemHasChildrenError,
	NativeItemHasPublishedFileError,
	NativeItemParentUnavailableError,
} from "@/lib/admin/native-item-service";
import { NativeItemValidationError } from "@/lib/admin/native-item-validation";
import { InvalidPdfError } from "@/lib/admin/pdf-processing";

function wrappedDatabaseError(code: string) {
	const cause = Object.assign(new Error("database rejected write"), {
		code,
	});
	return new DrizzleQueryError("insert into item", [], cause);
}

describe("admin API error mapping", () => {
	it("unwraps Drizzle foreign-key and check violations as bad requests", async () => {
		for (const code of ["23503", "23514"]) {
			const response = adminErrorResponse(wrappedDatabaseError(code));
			expect(response.status).toBe(400);
			expect(response.headers.get("cache-control")).toBe(
				"private, no-store",
			);
			expect(await response.json()).toEqual({
				error: {
					code: "invalid_reference",
					message:
						"Some selected records are no longer available. Refresh and try again.",
				},
			});
		}
	});

	it("unwraps Drizzle unique violations as conflicts", async () => {
		const response = adminErrorResponse(wrappedDatabaseError("23505"));
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: "already_exists",
				message: "This record already exists.",
			},
		});
	});

	it("returns structured field errors for domain validation failures", async () => {
		const response = adminErrorResponse(
			new NativeItemValidationError("Record cannot be published.", {
				"creators.0":
					"Enter a name for this creator, or remove the empty creator.",
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "validation_failed",
				fields: {
					"creators.0":
						"Enter a name for this creator, or remove the empty creator.",
				},
				message: "Record cannot be published.",
			},
		});
	});

	it("returns actionable collection and PDF field errors", async () => {
		const collectionResponse = adminErrorResponse(
			new NativeCollectionValidationError(
				"Choose another parent collection.",
				{
					parentCollection:
						"A collection cannot be placed inside itself or one of its subcollections.",
				},
			),
		);
		expect(await collectionResponse.json()).toMatchObject({
			error: {
				code: "validation_failed",
				fields: {
					parentCollection:
						"A collection cannot be placed inside itself or one of its subcollections.",
				},
			},
		});

		const fileResponse = adminErrorResponse(
			new NativeFileValidationError("Choose another PDF.", {
				file: "This PDF is larger than the upload limit.",
			}),
		);
		expect(await fileResponse.json()).toMatchObject({
			error: {
				code: "validation_failed",
				fields: {
					file: "This PDF is larger than the upload limit.",
				},
			},
		});

		const pdfResponse = adminErrorResponse(
			new InvalidPdfError("Choose a valid PDF file."),
		);
		expect(await pdfResponse.json()).toMatchObject({
			error: {
				code: "validation_failed",
				fields: { file: "Choose a valid PDF file." },
			},
		});
	});

	it("explains item preconditions instead of calling them stale edits", async () => {
		const cases = [
			[
				new NativeItemHasPublishedFileError("ABCD2345"),
				"Unpublish this attachment's PDF before unpublishing the attachment.",
			],
			[
				new NativeItemHasChildrenError("ABCD2345"),
				"Handle this record's attachments first: delete attachment drafts and unpublish published attachments.",
			],
			[
				new NativeItemParentUnavailableError("ABCD2345"),
				"The parent record is unavailable. Restore or publish it, then try again.",
			],
		] as const;

		for (const [error, message] of cases) {
			const response = adminErrorResponse(error);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				error: { code: "conflict", message },
			});
		}
	});

	it("turns Zod issues into human field errors", async () => {
		const schema = z.object({
			expectedRevision: z.number().int().positive(),
			name: z.string().trim().min(1).max(255),
		});
		const result = schema.safeParse({
			expectedRevision: "old",
			name: "",
		});
		expect(result.success).toBe(false);
		if (result.success) return;

		const response = adminErrorResponse(result.error);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "validation_failed",
				fields: {
					expectedRevision: "Revision must be a number.",
					name: "Name is required.",
				},
				message: "Check the highlighted fields and try again.",
			},
		});
	});

	it("describes numeric and root-level Zod failures in plain language", async () => {
		const revisionResult = z
			.object({ expectedRevision: z.number().int().positive() })
			.safeParse({ expectedRevision: 0 });
		expect(revisionResult.success).toBe(false);
		if (revisionResult.success) return;
		const revisionResponse = adminErrorResponse(revisionResult.error);
		expect(await revisionResponse.json()).toMatchObject({
			error: {
				fields: {
					expectedRevision: "Revision must be greater than 0.",
				},
			},
		});

		const objectResult = z.object({ name: z.string() }).safeParse("wrong");
		expect(objectResult.success).toBe(false);
		if (objectResult.success) return;
		const objectResponse = adminErrorResponse(objectResult.error);
		expect(await objectResponse.json()).toMatchObject({
			error: {
				fields: {
					_form: "Submitted information must be an object.",
				},
			},
		});
	});

	it("keeps nested item validation paths attached to their form fields", async () => {
		let validationError: unknown;
		try {
			const { validateNativeItemDraft } =
				await import("@/lib/admin/native-item-validation");
			validateNativeItemDraft({
				itemType: "book",
				creators: [
					{
						creatorType: "author",
						firstName: "",
						lastName: "",
					},
				],
			});
		} catch (error) {
			validationError = error;
		}

		const response = adminErrorResponse(validationError);
		expect(await response.json()).toMatchObject({
			error: {
				code: "validation_failed",
				fields: {
					"creators.0":
						"Enter a name for this creator, or remove the empty creator.",
				},
			},
		});
	});

	it("classifies malformed request bodies as form validation errors", async () => {
		let parseError: unknown;
		try {
			await readAdminJson(
				new Request("http://localhost/api/admin/items/drafts", {
					body: "{",
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);
		} catch (error) {
			parseError = error;
		}

		const response = adminErrorResponse(parseError);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "validation_failed",
				fields: {
					_form: "Reload the page and try again. If the problem continues, contact support.",
				},
				message: "The submitted information could not be read.",
			},
		});
	});
});
