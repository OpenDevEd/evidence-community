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
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function isAccessDate(value: string) {
	if (value === "CURRENT_TIMESTAMP") return true;
	const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/u.exec(
		value,
	);
	if (!match || !isCalendarDate(match[1]!)) return false;
	if (match[2] === undefined) return true;
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const second = Number(match[4]);
	if (hour > 23 || minute > 59 || second > 59) return false;
	if (match[6] === undefined) return true;
	const offsetHour = Number(match[6]);
	const offsetMinute = Number(match[7]);
	return (
		offsetHour <= 14 &&
		offsetMinute <= 59 &&
		(offsetHour < 14 || offsetMinute === 0)
	);
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
			return { error: "Keep this note at 500,000 characters or less.", value };
		}
	} else if (
		!descriptor.field.startsWith("annotation") &&
		utf8ByteLength(value) > 65_535
	) {
		return { error: "Keep this field at 65,535 bytes or less.", value };
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
		return isAccessDate(value)
			? { value }
			: { error: "Enter a real access date or timestamp.", value };
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
