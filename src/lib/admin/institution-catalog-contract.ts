import { z } from "zod";

import { AdminValidationError } from "./errors";

export const OPENSCHOLAR_INSTITUTION_PAGE_SIZE = 50;
export const OPENSCHOLAR_INSTITUTION_MAX_PAGE_SIZE = 200;

const institutionSortSchema = z.enum(["count", "name"]);

export type OpenScholarInstitutionSort = z.infer<typeof institutionSortSchema>;

const institutionRequestSchema = z.object({
	cursor: z.string().min(1).nullable().default(null),
	// A picker that asks for too much gets a full page, not an error.
	pageSize: z.coerce
		.number()
		.int()
		.min(1)
		.default(OPENSCHOLAR_INSTITUTION_PAGE_SIZE)
		.transform((value) =>
			Math.min(value, OPENSCHOLAR_INSTITUTION_MAX_PAGE_SIZE),
		),
	query: z.string().trim().max(200).default(""),
	sort: institutionSortSchema.default("count"),
});

export type OpenScholarInstitutionRequest = z.infer<
	typeof institutionRequestSchema
>;

export function parseOpenScholarInstitutionRequest(
	value: unknown,
): OpenScholarInstitutionRequest {
	return institutionRequestSchema.parse(value);
}

const institutionCursorSchema = z.object({
	v: z.literal(1),
	count: z.number().int().min(0),
	name: z.string().min(1),
	query: z.string(),
	sort: institutionSortSchema,
});

export type OpenScholarInstitutionCursor = Omit<
	z.infer<typeof institutionCursorSchema>,
	"v"
>;

export function encodeOpenScholarInstitutionCursor(
	cursor: OpenScholarInstitutionCursor,
) {
	return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString(
		"base64url",
	);
}

export function decodeOpenScholarInstitutionCursor(
	encoded: string,
): OpenScholarInstitutionCursor {
	try {
		const { v: _version, ...cursor } = institutionCursorSchema.parse(
			JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
		);
		return cursor;
	} catch {
		throw new AdminValidationError(
			"The saved institution position is invalid or expired. Search again.",
			{ cursor: "Search again to start from the first result." },
		);
	}
}

/**
 * Reads the cursor a request carries and refuses one that was saved for a
 * different search or sort, because it would skip or repeat rows.
 */
export function institutionCursorFor(request: OpenScholarInstitutionRequest) {
	if (!request.cursor) return null;
	const cursor = decodeOpenScholarInstitutionCursor(request.cursor);
	if (
		cursor.query !== request.query.toLowerCase() ||
		cursor.sort !== request.sort
	) {
		throw new AdminValidationError(
			"The saved institution position does not match this search. Search again.",
			{ cursor: "Search again to start from the first result." },
		);
	}
	return cursor;
}
