import type { ZoteroFieldDescriptor } from "@opendeved/evidence-library-core/zotero-schema";

import { parseBibliographicDate } from "@/lib/bibliographic-date";

export type AdminFieldKind =
	| "access-date"
	| "annotation-type"
	| "bibliographic-date"
	| "color"
	| "multiline"
	| "text"
	| "url";

export type AdminFieldDescriptor = Pick<
	ZoteroFieldDescriptor,
	"field" | "semanticField" | "type"
>;

export const ADMIN_ANNOTATION_TYPES = [
	"highlight",
	"underline",
	"note",
	"text",
	"image",
	"ink",
] as const;

const MULTILINE_FIELDS = new Set([
	"abstractNote",
	"annotationComment",
	"annotationText",
	"extra",
	"history",
	"note",
	"references",
]);

export function adminFieldContract(descriptor: AdminFieldDescriptor): {
	kind: AdminFieldKind;
} {
	if (descriptor.type === "date") return { kind: "bibliographic-date" };
	if (descriptor.field === "accessDate") return { kind: "access-date" };
	if (descriptor.field === "url") return { kind: "url" };
	if (descriptor.field === "annotationType") {
		return { kind: "annotation-type" };
	}
	if (descriptor.field === "annotationColor") return { kind: "color" };
	if (MULTILINE_FIELDS.has(descriptor.field)) return { kind: "multiline" };
	return { kind: "text" };
}

function isCalendarDate(value: string) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1) return false;
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [
		31,
		leapYear ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	];
	return day <= daysInMonth[month - 1]!;
}

function normalizeAccessDate(value: string) {
	const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/u.exec(
		value,
	);
	if (!match || !isCalendarDate(match[1]!)) return null;
	if (match[2] === undefined) return match[1]!;
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const second = Number(match[4]);
	if (hour > 23 || minute > 59 || second > 59) return null;
	if (match[6] === undefined) return match[1]!;
	const offsetHour = Number(match[6]);
	const offsetMinute = Number(match[7]);
	return (
		offsetHour <= 14 &&
		offsetMinute <= 59 &&
		(offsetHour < 14 || offsetMinute === 0)
	)
		? match[1]!
		: null;
}

export function utf8ByteLength(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

export function normalizeAdminFieldValue(
	descriptor: AdminFieldDescriptor,
	input: string,
): { error?: string; value: string } {
	const value = input.trim();
	if (!value) return { value: "" };
	const { kind } = adminFieldContract(descriptor);
	if (descriptor.field === "note") {
		if ([...value].length > 500_000) {
			return { error: "Shorten this note to 500,000 characters or fewer.", value };
		}
	} else if (
		!descriptor.field.startsWith("annotation") &&
		utf8ByteLength(value) > 65_535
	) {
		return {
			error: "This value is too long. Shorten it and try again.",
			value,
		};
	}

	if (kind === "bibliographic-date") {
		if (parseBibliographicDate(value).kind === "invalid") {
			return {
				error: "Enter an exact date or a four-digit year.",
				value,
			};
		}
		return { value };
	}
	if (kind === "access-date") {
		const accessDate = normalizeAccessDate(value);
		return accessDate
			? { value: accessDate }
			: { error: "Choose an access date.", value };
	}
	if (kind === "url") {
		try {
			const url = new URL(value);
			if (url.protocol === "http:" || url.protocol === "https:") {
				return { value: url.toString() };
			}
		} catch {}
		return { error: "Enter a full HTTP or HTTPS address.", value };
	}
	if (
		kind === "annotation-type" &&
		!ADMIN_ANNOTATION_TYPES.includes(
			value as (typeof ADMIN_ANNOTATION_TYPES)[number],
		)
	) {
		return { error: "Choose a valid annotation type.", value };
	}
	if (kind === "color" && !/^#[\da-f]{6}$/iu.test(value)) {
		return { error: "Choose a six-digit colour.", value };
	}
	return { value };
}
