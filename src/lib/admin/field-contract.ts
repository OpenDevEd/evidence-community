import type { ZoteroFieldDescriptor } from "@opendeved/evidence-library-core/zotero-schema";

import { parseBibliographicDate } from "@/lib/bibliographic-date";
import {
	formatInstitutionNames,
	parseInstitutionNames,
} from "@/config/library-config/institutions";

export type AdminFieldKind =
	| "access-date"
	| "annotation-type"
	| "bibliographic-date"
	| "color"
	| "institution-list"
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
	if (descriptor.field === "institution" || descriptor.field === "university")
		return { kind: "institution-list" };
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

/** Returns the calendar date of an access date, or null when it is not one. */
export function normalizeAccessDate(value: string) {
	const match =
		/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/u.exec(
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
	return offsetHour <= 14 &&
		offsetMinute <= 59 &&
		(offsetHour < 14 || offsetMinute === 0)
		? match[1]!
		: null;
}

export function utf8ByteLength(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

export function normalizeAdminFieldValue(
	descriptor: AdminFieldDescriptor,
	input: string,
	options: {
		/**
		 * Keep a date or address the editor cannot parse as text instead of
		 * reporting it. Used for records copied from an external source; the
		 * length limits still apply.
		 */
		keepUnparsed?: boolean;
	} = {},
): { error?: string; value: string } {
	const { kind } = adminFieldContract(descriptor);
	const value =
		kind === "institution-list"
			? formatInstitutionNames(parseInstitutionNames(input))
			: input.trim();
	if (!value) return { value: "" };
	const lengthError = fieldLengthError(descriptor, value);
	if (lengthError) return lengthError;

	if (kind === "bibliographic-date") {
		if (
			!options.keepUnparsed &&
			parseBibliographicDate(value).kind === "invalid"
		) {
			return {
				error: "Enter an exact date, a month, or a four-digit year.",
				value,
			};
		}
		return { value };
	}
	if (kind === "access-date") {
		// The editor uses a calendar control, so a value that is not a calendar
		// date can only come from old stored data (for example the text
		// CURRENT_TIMESTAMP) or an API caller. Clear it instead of blocking the
		// save, so the next save repairs the record.
		return { value: normalizeAccessDate(value) ?? "" };
	}
	if (kind === "url") return normalizeFieldUrl(value, options.keepUnparsed);

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

function fieldLengthError(descriptor: AdminFieldDescriptor, value: string) {
	if (descriptor.field === "note") {
		if ([...value].length > 500_000) {
			return {
				error: "Shorten this note to 500,000 characters or fewer.",
				value,
			};
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

	return null;
}

function normalizeFieldUrl(value: string, keepUnparsed = false) {
	try {
		const url = new URL(value);
		if (url.protocol === "http:" || url.protocol === "https:") {
			return { value: url.toString() };
		}
	} catch {}
	if (keepUnparsed) return { value };
	return { error: "Enter a full HTTP or HTTPS address.", value };
}
