import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: () => ({
		authentication: {
			openScholar: {
				convexSiteUrl: "https://spotted-woodpecker-546.convex.site",
				libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
				machineCredential: `els_${"a".repeat(43)}`,
			},
		},
	}),
}));

import {
	adminErrorResponse,
	readAdminJson,
	requireAdminPermission,
} from "@/lib/admin/http";
import {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_LIBRARY_PERMISSION,
} from "@/lib/admin/access";
import { signedInHeaders } from "../helpers/reader-session";
import { CollectionWritebackUnavailableError } from "@/lib/admin/collection-mutation-service";
import { CollectionValidationError } from "@/lib/admin/native-collection-service";
import {
	NativeFileValidationError,
	ZenodoPdfCorrectionConfirmationRequiredError,
} from "@/lib/admin/native-file-service";
import {
	ItemHasChildrenError as NativeItemHasChildrenError,
	ItemHasActivePublicationError as NativeItemHasActivePublicationError,
	ItemHasPublishedFileError as NativeItemHasPublishedFileError,
	ItemParentUnavailableError as NativeItemParentUnavailableError,
} from "@/lib/admin/native-item-service";
import { NativeItemValidationError } from "@/lib/admin/native-item-validation";
import { InvalidPdfError } from "@/lib/admin/pdf-processing";
import {
	CrossrefActivationConfigurationError,
	CrossrefActivationValidationError,
	CrossrefDoiAlreadyManagedError,
	ExternalCrossrefDoiError,
	ZenodoActivationConfigurationError,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
} from "@/lib/publication/errors";

function wrappedDatabaseError(code: string) {
	const cause = Object.assign(new Error("database rejected write"), {
		code,
	});
	return new DrizzleQueryError("insert into item", [], cause);
}

let signedInUser = 0;
/** A request from someone signed in; OpenScholar's role answer is kept per person, so each is new. */
function adminRequest(role?: "owner" | "editor") {
	signedInUser += 1;
	return { headers: signedInHeaders(role ? `user_http_${signedInUser}` : undefined) };
}

describe("admin API session gate", () => {
  afterEach(() => vi.unstubAllGlobals());
	it("returns 401 without a valid session", async () => {
		const response = await requireAdminPermission(
			adminRequest(),
			ADMIN_CONTENT_PERMISSION,
		);

		expect(response?.status).toBe(401);
		expect(response?.headers.get("Cache-Control")).toBe(
			"private, no-store",
		);
		expect(await response?.json()).toMatchObject({
			error: {
				code: "unauthorized",
			},
		});
	});

	it("allows Owners and Editors to manage content", async () => {
		for (const role of ["owner", "editor"] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role })));
			expect(
				await requireAdminPermission(
					adminRequest(role),
					ADMIN_CONTENT_PERMISSION,
				),
			).toBeNull();
		}
	});

	it("returns 403 when an Editor requests an Owner-only permission", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role: "editor" })));
		const response = await requireAdminPermission(
			adminRequest("editor"),
			ADMIN_LIBRARY_PERMISSION,
		);

		expect(response?.status).toBe(403);
		expect(response?.headers.get("Cache-Control")).toBe(
			"private, no-store",
		);
		expect(
			await response?.json(),
		).toMatchObject({ error: { code: "forbidden" } });
	});

  it("returns 503 when current access cannot be verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const response = await requireAdminPermission(adminRequest("owner"), ADMIN_CONTENT_PERMISSION);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: { code: "access_unavailable" } });
  });

	it("allows an Owner to manage the library", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ role: "owner" })));
		expect(
			await requireAdminPermission(
				adminRequest("owner"),
				ADMIN_LIBRARY_PERMISSION,
			),
		).toBeNull();
	});
});

describe("admin API error mapping", () => {
	it("returns plain Crossref activation errors", async () => {
		const validation = adminErrorResponse(
			new CrossrefActivationValidationError(
				"Complete the required Crossref fields and try again.",
				{ publicationTitle: "Add a journal title." },
			),
		);
		expect(validation.status).toBe(400);
		expect(await validation.json()).toEqual({
			error: {
				code: "validation_failed",
				fields: { publicationTitle: "Add a journal title." },
				message: "Complete the required Crossref fields and try again.",
			},
		});

		for (const error of [
			new CrossrefActivationConfigurationError(
				"Crossref test publishing is not configured for this library.",
			),
			new ExternalCrossrefDoiError("10.9999/external"),
			new CrossrefDoiAlreadyManagedError(
				"10.5555/library.000001",
				"ABCDEFGH",
			),
		]) {
			const response = adminErrorResponse(error);
			expect(response.status).toBe(409);
			expect((await response.json()).error.code).toBe("conflict");
		}
	});

	it("returns plain Zenodo activation errors", async () => {
		const validation = adminErrorResponse(
			new ZenodoActivationValidationError("Publish a PDF first.", {
				identifierPolicy: "Choose a DOI option.",
			}),
		);
		expect(validation.status).toBe(400);
		expect(await validation.json()).toEqual({
			error: {
				code: "validation_failed",
				fields: { identifierPolicy: "Choose a DOI option." },
				message: "Publish a PDF first.",
			},
		});

		for (const error of [
			new ZenodoActivationConfigurationError("Zenodo is not configured."),
			new ZenodoIdentifierPolicyLockedError(),
		]) {
			const response = adminErrorResponse(error);
			expect(response.status).toBe(409);
			expect((await response.json()).error.code).toBe("conflict");
		}
	});

	it("returns a distinct PDF correction confirmation", async () => {
		const response = adminErrorResponse(
			new ZenodoPdfCorrectionConfirmationRequiredError(
				new Date("2030-09-12T14:30:00.000Z"),
			),
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: "confirmation_required",
				message:
					"This record reuses its DOI in Zenodo. Changing its published PDFs will update the same Zenodo record and DOI. Confirm that this is a minor correction. Approval closes at Sep 12, 2030, 2:30 PM UTC.",
			},
		});
	});

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
			new CollectionValidationError("Choose another parent collection.", {
				parentCollection:
					"A collection cannot be placed inside itself or one of its subcollections.",
			}),
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

	it("explains when collection writeback is disabled", async () => {
		const response = adminErrorResponse(
			new CollectionWritebackUnavailableError(
				"ABCD2345",
				"source-disabled",
			),
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: {
				code: "conflict",
				message: "Writeback is disabled for this collection's source.",
			},
		});
	});

	it("explains item preconditions instead of calling them stale edits", async () => {
		const cases = [
			[
				new NativeItemHasActivePublicationError("ABCD2345"),
				"This record has a DOI, so it can't be deleted. Withdraw it from its editor, with a reason readers will see.",
			],
			[
				new NativeItemHasPublishedFileError("ABCD2345"),
				expect.stringMatching(/\S/u),
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
