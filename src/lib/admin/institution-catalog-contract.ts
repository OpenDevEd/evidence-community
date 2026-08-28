import { z } from "zod";

import { AdminValidationError } from "./errors";

const OPENSCHOLAR_INSTITUTION_PAGE_SIZE = 50;
const OPENSCHOLAR_INSTITUTION_MAX_PAGE_SIZE = 200;

const institutionSortSchema = z.enum(["count", "name"]);
const institutionDirectionSchema = z.enum(["asc", "desc"]);

/** Most records first when sorting by count, A to Z when sorting by name. */
function defaultDirection(sort: z.infer<typeof institutionSortSchema>) {
	return sort === "count" ? "desc" : "asc";
}

const institutionRequestSchema = z
	.object({
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
	direction: institutionDirectionSchema.nullable().default(null),
	query: z.string().trim().max(200).default(""),
	sort: institutionSortSchema.default("count"),
	})
	.transform((request) => ({
		...request,
		direction: request.direction ?? defaultDirection(request.sort),
	}));

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
	direction: institutionDirectionSchema,
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
		cursor.query !== request.query ||
		cursor.sort !== request.sort ||
		cursor.direction !== request.direction
	) {
		throw new AdminValidationError(
			"The saved institution position does not match this search. Search again.",
			{ cursor: "Search again to start from the first result." },
		);
	}
	return cursor;
}
