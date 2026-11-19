import { z, type ZodError, type ZodIssue } from "zod";

const adminErrorCodes = [
	"already_exists",
	"conflict",
	"confirmation_required",
	"forbidden",
	"internal_error",
	"invalid_reference",
	"not_found",
	"storage_unavailable",
	"unauthorized",
	"validation_failed",
] as const;

const adminErrorCodeSet: ReadonlySet<string> = new Set(adminErrorCodes);

export type AdminErrorCode = (typeof adminErrorCodes)[number];

export function isAdminErrorCode(value: unknown): value is AdminErrorCode {
	return typeof value === "string" && adminErrorCodeSet.has(value);
}

export type AdminFieldErrors = Record<string, string>;

export const conflictingDraftSchema = z.object({
	generation: z.string().min(1),
	draftRevision: z.number().int().nonnegative(),
	payload: z.record(z.string(), z.unknown()),
});

export type ConflictingDraft = z.infer<typeof conflictingDraftSchema>;

export type AdminErrorPayload = {
	error: {
		code: AdminErrorCode;
		fields?: AdminFieldErrors;
		conflictingDraft?: ConflictingDraft;
		message: string;
	};
};

export class AdminValidationError extends Error {
	readonly fields: AdminFieldErrors;

	constructor(
		message: string,
		fields: AdminFieldErrors = {},
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "AdminValidationError";
		this.fields = fields;
	}
}

const fieldLabels: Record<string, string> = {
	abstractNote: "Abstract",
	countryFocus: "Country focus",
	openAccess: "Open access",
	studyType: "Study type",
	licence: "Licence",
	fileAccess: "Who gets the file",
	beforeCollection: "Collection position",
	expectedDraftRevision: "Draft revision",
	expectedRevision: "Revision",
	expectedSha256: "File checksum",
	expectedSizeBytes: "File size",
	expectedUploadRevision: "File version",
	itemType: "Item type",
	parentCollection: "Parent collection",
	parentItem: "Parent record",
	url: "URL",
};

export function adminFieldLabel(path: string) {
	if (path === "_form") return "Submitted information";
	const field = path
		.split(".")
		.filter((part) => !/^\d+$/u.test(part))
		.at(-1);
	if (!field) return "This value";
	return (
		fieldLabels[field] ??
		field
			.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
			.replace(/[_-]+/gu, " ")
			.replace(/^./u, (character) => character.toUpperCase())
	);
}

function issueMessage(issue: ZodIssue, label: string) {
	if (issue.code === "invalid_type") {
		const expected =
			issue.expected === "string"
				? "text"
				: issue.expected === "number"
					? "a number"
					: issue.expected === "int"
						? "a whole number"
						: issue.expected === "array"
							? "a list"
							: issue.expected === "object"
								? "an object"
								: "a valid value";
		return `${label} must be ${expected}.`;
	}

	if (issue.code === "too_small") {
		if (
			issue.origin === "number" ||
			issue.origin === "int" ||
			issue.origin === "bigint"
		) {
			return issue.inclusive
				? `${label} must be ${issue.minimum} or greater.`
				: `${label} must be greater than ${issue.minimum}.`;
		}
		if (issue.minimum === 1) return `${label} is required.`;
		return `${label} must contain at least ${issue.minimum} ${
			issue.origin === "string" ? "characters" : "items"
		}.`;
	}

	if (issue.code === "too_big") {
		if (
			issue.origin === "number" ||
			issue.origin === "int" ||
			issue.origin === "bigint"
		) {
			return issue.inclusive
				? `${label} must be ${issue.maximum} or less.`
				: `${label} must be less than ${issue.maximum}.`;
		}
		return `${label} must contain no more than ${issue.maximum} ${
			issue.origin === "string" ? "characters" : "items"
		}.`;
	}

	if (issue.code === "invalid_value") {
		return `Choose a valid ${label.toLowerCase()}.`;
	}

	if (issue.code === "unrecognized_keys") {
		return `Remove unsupported ${
			issue.keys.length === 1 ? "field" : "fields"
		}: ${issue.keys.join(", ")}.`;
	}

	if (issue.code === "custom" && issue.message) {
		return issue.message;
	}

	return `Enter a valid ${label.toLowerCase()}.`;
}

export function fieldErrorsFromZod(
	error: ZodError,
	prefix: Array<number | string> = [],
): AdminFieldErrors {
	const fields: AdminFieldErrors = {};
	for (const issue of error.issues) {
		const fullPath = [...prefix, ...issue.path];
		const path = fullPath.length > 0 ? fullPath.join(".") : "_form";
		fields[path] ??= issueMessage(issue, adminFieldLabel(path));
	}
	return fields;
}

export function validationErrorPayload(
	message: string,
	fields: AdminFieldErrors = {},
): AdminErrorPayload["error"] {
	return {
		code: "validation_failed",
		...(Object.keys(fields).length > 0 ? { fields } : {}),
		message,
	};
}
