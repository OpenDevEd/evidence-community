import { z } from "zod";

const DISALLOWED_CONTROL_CHARACTERS =
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const SINGLE_LINE_BREAKS = /[\r\n]/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u;
const TAG_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

export function nonEmptyStringSchema(
	maximum: number,
) {
	return z
		.string()
		.trim()
		.min(1)
		.max(maximum)
		.refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value), {
			message: "Control characters are not allowed",
		});
}

export function singleLineStringSchema(
	maximum: number,
) {
	return z
		.string()
		.trim()
		.min(1)
		.max(maximum)
		.refine(
			(value) =>
				!DISALLOWED_CONTROL_CHARACTERS.test(value) &&
				!SINGLE_LINE_BREAKS.test(value),
			{
				message: "Control characters and line breaks are not allowed",
			},
		);
}

export function plainTextSchema(
	maximum: number,
) {
	return z
		.string()
		.trim()
		.max(maximum)
		.refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value), {
			message: "Control characters are not allowed",
		});
}

export const rawStringSchema = z
	.string()
	.trim()
	.refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value), {
		message: "Control characters are not allowed",
	});

export const idSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(ID_PATTERN, {
		message:
			"ID must start with a letter or number and contain only letters, numbers, underscores, or hyphens",
	})
	.refine(
		(value) =>
			!DISALLOWED_CONTROL_CHARACTERS.test(value) &&
			!SINGLE_LINE_BREAKS.test(value),
		{
			message: "Control characters and line breaks are not allowed",
		},
	);

export const revisionSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, {
		message:
			"Revision must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens",
	})
	.refine(
		(value) =>
			!DISALLOWED_CONTROL_CHARACTERS.test(value) &&
			!SINGLE_LINE_BREAKS.test(value),
		{
			message: "Control characters and line breaks are not allowed",
		},
	);

export const utcTimestampSchema = z
	.string()
	.trim()
	.datetime({ offset: false })
	.refine((value) => value.endsWith("Z"), {
		message: "Timestamp must use the UTC Z suffix",
	});

type UrlRules = {
	protocols: readonly string[];
	originOnly?: boolean;
	stable?: boolean;
	noQuery?: boolean;
	extensions?: readonly string[];
};

function urlSchema({
	protocols,
	originOnly = false,
	stable = false,
	noQuery = false,
	extensions,
}: UrlRules) {
	return z
		.string()
		.trim()
		.min(1)
		.max(2048)
		.superRefine((value, context) => {
			let parsed: URL;

			if (/[<>]/u.test(value)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Raw HTML delimiter characters are not allowed in URLs",
				});
			}

			try {
				parsed = new URL(value);
			} catch {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Must be an absolute URL",
				});
				return;
			}

			if (!protocols.includes(parsed.protocol)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `URL protocol must be ${protocols.join(" or ")}`,
				});
			}

			if (parsed.username || parsed.password) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "URL credentials are not allowed",
				});
			}

			if (parsed.hash) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "URL fragments are not allowed",
				});
			}

			if (originOnly && (parsed.pathname !== "/" || parsed.search)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "URL must contain only an origin",
				});
			}

			if (stable && parsed.search) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Stable URLs cannot contain query parameters or signed-URL tokens",
				});
			}

			if (noQuery && parsed.search) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "URL query parameters are not allowed",
				});
			}

			if (
				extensions &&
				!extensions.some((extension) =>
					parsed.pathname.toLowerCase().endsWith(extension),
				)
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `URL path must end in ${extensions.join(", ")}`,
				});
			}
		})
		.meta({ format: "uri" });
}

export const publicHttpsUrlSchema = urlSchema({
	protocols: ["https:"],
});

export const publicHttpsOriginSchema = urlSchema({
	protocols: ["https:"],
	originOnly: true,
});

export const publicWebOriginSchema = urlSchema({
	protocols: ["http:", "https:"],
	originOnly: true,
});

export const stableImageUrlSchema = urlSchema({
	protocols: ["https:"],
	stable: true,
	extensions: [".svg", ".png", ".webp"],
});

export const stableIconUrlSchema = urlSchema({
	protocols: ["https:"],
	stable: true,
	extensions: [".svg", ".png", ".ico"],
});

export const stableWoff2UrlSchema = urlSchema({
	protocols: ["https:"],
	stable: true,
	extensions: [".woff2"],
});

export const stableHtmlUrlSchema = urlSchema({
	protocols: ["https:"],
	stable: true,
	extensions: [".html", ".htm"],
});

export const serviceUrlSchema = urlSchema({
	protocols: ["http:", "https:"],
	noQuery: true,
});

export const postgresUrlSchema = z
	.string()
	.trim()
	.min(1)
	.max(4096)
	.superRefine((value, context) => {
		try {
			const parsed = new URL(value);
			if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
				throw new Error("invalid protocol");
			}
		} catch {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Must be a valid postgres: or postgresql: URL",
			});
		}
	})
	.meta({ format: "uri", writeOnly: true });

function decodedPathSegments(value: string) {
	let decoded = value;

	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const next = decodeURIComponent(decoded);
			if (next === decoded) break;
			decoded = next;
		} catch {
			return null;
		}
	}

	return decoded.split(/[?#]/u, 1)[0].split("/");
}

export const internalLinkSchema = z
	.string()
	.trim()
	.min(1)
	.max(2048)
	.superRefine((value, context) => {
		if (!value.startsWith("/") || value.startsWith("//")) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Internal links must start with one forward slash",
			});
		}

		if (value.includes("\\")) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Backslashes are not allowed in internal links",
			});
		}

		const segments = decodedPathSegments(value);
		if (!segments || segments.includes("..")) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Path traversal is not allowed",
			});
		}
	});

export const linkSchema = z.union([
	internalLinkSchema,
	publicHttpsUrlSchema,
]);

export const colorSchema = z
	.string()
	.trim()
	.regex(COLOR_PATTERN, {
		message: "Color must use #RRGGBB or #RRGGBBAA",
	});

export const tagSchema = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.refine((value) => !TAG_CONTROL_CHARACTERS.test(value), {
		message: "Tags cannot contain control characters or line breaks",
	});

export const emailSchema = z.string().trim().email().max(254);

export function secretSchema(minimum: number, maximum: number) {
	return z
		.string()
		.trim()
		.min(minimum)
		.max(maximum)
		.refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value), {
			message: "Control characters are not allowed",
		})
		.meta({ writeOnly: true });
}

function isValidIpv4(value: string) {
	const octets = value.split(".");
	return (
		octets.length === 4 &&
		octets.every(
			(octet) =>
				/^\d{1,3}$/u.test(octet) &&
				Number(octet) >= 0 &&
				Number(octet) <= 255,
		)
	);
}

function isValidIpv6(value: string) {
	const unwrapped = value.replace(/^\[|\]$/gu, "");
	if (!unwrapped.includes(":") || !/^[0-9A-Fa-f:]+$/u.test(unwrapped)) {
		return false;
	}

	try {
		return new URL(`http://[${unwrapped}]`).hostname.length > 0;
	} catch {
		return false;
	}
}

function isValidHostname(value: string) {
	if (value.length > 253 || value.endsWith(".")) return false;

	return value.split(".").every(
		(label) =>
			label.length >= 1 &&
			label.length <= 63 &&
			/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
	);
}

export const hostSchema = z
	.string()
	.trim()
	.min(1)
	.max(253)
	.refine(
		(value) =>
			isValidIpv4(value) || isValidIpv6(value) || isValidHostname(value),
		{
			message: "Must be a valid hostname or IP address",
		},
	);

export const modelIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, {
		message: "Invalid model ID",
	})
	.refine(
		(value) =>
			!DISALLOWED_CONTROL_CHARACTERS.test(value) &&
			!SINGLE_LINE_BREAKS.test(value),
		{
			message: "Control characters and line breaks are not allowed",
		},
	);

export function addDuplicateIssues<T>(
	values: readonly T[],
	context: z.RefinementCtx,
	key: (value: T) => string,
	pathPrefix: (string | number)[] = [],
) {
	const seen = new Map<string, number>();

	values.forEach((value, index) => {
		const normalized = key(value);
		const firstIndex = seen.get(normalized);

		if (firstIndex !== undefined) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Duplicate value also used at index ${firstIndex}`,
				path: [...pathPrefix, index],
			});
			return;
		}

		seen.set(normalized, index);
	});
}
