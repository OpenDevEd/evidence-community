import { z } from "zod";

import { AdminValidationError } from "./errors";

export const ADMIN_COLLECTION_PAGE_SIZE = 50;
export const ADMIN_COLLECTION_MAX_PAGE_SIZE = 100;

const collectionViewSchema = z.enum(["children", "resolve", "search"]);

export function parseAdminCollectionView(value: unknown) {
	const result = collectionViewSchema.safeParse(value);
	if (!result.success) {
		throw new AdminValidationError(
			"The collection request is invalid. Reload the page and try again.",
			{ _form: "Reload the page and try again." },
		);
	}
	return result.data;
}

const collectionKeySchema = z.string().length(8);
const booleanParameterSchema = z.preprocess(
	(value) => {
		if (value === "true") return true;
		if (value === "false") return false;
		return value;
	},
	z.boolean(),
);

const childrenRequestSchema = z.object({
	cursor: z.string().min(1).nullable().default(null),
	pageSize: z.coerce
		.number()
		.int()
		.min(1)
		.max(ADMIN_COLLECTION_MAX_PAGE_SIZE)
		.default(ADMIN_COLLECTION_PAGE_SIZE),
	parentCollection: collectionKeySchema.nullable().default(null),
	sourceConnectionKey: z.string().trim().min(1).max(64),
});

export type AdminCollectionChildrenRequest = z.infer<
	typeof childrenRequestSchema
>;

export function parseAdminCollectionChildrenRequest(
	value: unknown,
): AdminCollectionChildrenRequest {
	return childrenRequestSchema.parse(value);
}

const childrenCursorSchema = z.object({
	v: z.literal(1),
	key: collectionKeySchema,
	name: z.string(),
	parentCollection: collectionKeySchema.nullable(),
	sortOrder: z.number().int(),
	sourceConnectionKey: z.string().min(1).max(64),
});

const searchRequestSchema = z.object({
	cursor: z.string().min(1).nullable().default(null),
	editableOnly: booleanParameterSchema.default(false),
	includeDeleted: booleanParameterSchema.default(false),
	pageSize: z.coerce
		.number()
		.int()
		.min(1)
		.max(ADMIN_COLLECTION_MAX_PAGE_SIZE)
		.default(ADMIN_COLLECTION_PAGE_SIZE),
	query: z.string().trim().min(1).max(200),
	sourceConnectionKey: z.string().trim().min(1).max(64).nullable().default(null),
});

export type AdminCollectionSearchRequest = z.infer<typeof searchRequestSchema>;

export function parseAdminCollectionSearchRequest(
	value: unknown,
): AdminCollectionSearchRequest {
	return searchRequestSchema.parse(value);
}

const searchCursorSchema = z.object({
	v: z.literal(1),
	editableOnly: z.boolean(),
	includeDeleted: z.boolean(),
	key: collectionKeySchema,
	name: z.string(),
	query: z.string(),
	sourceConnectionKey: z.string().min(1).max(64).nullable(),
	rowSourceConnectionKey: z.string().min(1).max(64),
});

export type AdminCollectionSearchCursor = Omit<
	z.infer<typeof searchCursorSchema>,
	"v"
>;

export function encodeAdminCollectionSearchCursor(
	cursor: AdminCollectionSearchCursor,
) {
	return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString(
		"base64url",
	);
}

export function decodeAdminCollectionSearchCursor(
	encoded: string,
): AdminCollectionSearchCursor {
	try {
		const { v: _version, ...cursor } = searchCursorSchema.parse(
			JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
		);
		return cursor;
	} catch {
		throw new AdminValidationError(
			"The saved collection search position is invalid or expired. Search again.",
			{ cursor: "Search again to start from the first result." },
		);
	}
}

const resolveKeysSchema = z
	.array(collectionKeySchema)
	.min(1)
	.max(100)
	.refine((keys) => new Set(keys).size === keys.length, {
		message: "Collection keys must be unique",
	});

export function parseAdminCollectionResolveKeys(value: unknown) {
	return resolveKeysSchema.parse(value);
}

export type AdminCollectionChildrenCursor = Omit<
	z.infer<typeof childrenCursorSchema>,
	"v"
>;

export function encodeAdminCollectionChildrenCursor(
	cursor: AdminCollectionChildrenCursor,
) {
	return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString(
		"base64url",
	);
}

export function decodeAdminCollectionChildrenCursor(
	encoded: string,
): AdminCollectionChildrenCursor {
	try {
		const { v: _version, ...cursor } = childrenCursorSchema.parse(
			JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
		);
		return cursor;
	} catch {
		throw new AdminValidationError(
			"The saved collection position is invalid or expired. Reload the collections and try again.",
			{ cursor: "Reload the collections to start from the first page." },
		);
	}
}
