import type { ZoteroFieldDescriptor } from "@opendeved/evidence-library-core/zotero-schema";

import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { normalizeDoi } from "@/lib/doi";

export type AdminFieldKind =
	| "access-date"
	| "annotation-type"
	| "bibliographic-date"
	| "color"
	| "doi"
	| "isbn"
	| "issn"
	| "multiline"
	| "pmcid"
	| "pmid"
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

const IDENTIFIER_KINDS = new Map<string, AdminFieldKind>([
	["DOI", "doi"],
	["ISBN", "isbn"],
	["ISSN", "issn"],
	["PMCID", "pmcid"],
	["PMID", "pmid"],
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
	const identifierKind = IDENTIFIER_KINDS.get(descriptor.semanticField);
	if (identifierKind) return { kind: identifierKind };
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
	const datePart = value.slice(0, 10);
	if (!isCalendarDate(datePart)) return false;
	if (value.length === 10) return true;
	return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?)$/u.test(
		value,
	);
}

function validIsbn(value: string) {
	const compact = value.replace(/[\s-]/gu, "").toUpperCase();
	if (/^\d{9}[\dX]$/u.test(compact)) {
		const total = [...compact].reduce(
			(sum, character, index) =>
				sum +
				(character === "X" ? 10 : Number(character)) * (10 - index),
			0,
		);
		return total % 11 === 0;
	}
	if (!/^\d{13}$/u.test(compact)) return false;
	const total = [...compact].reduce(
		(sum, character, index) =>
			sum + Number(character) * (index % 2 === 0 ? 1 : 3),
		0,
	);
	return total % 10 === 0;
}

function validIssn(value: string) {
	const compact = value.replace(/[\s-]/gu, "").toUpperCase();
	if (!/^\d{7}[\dX]$/u.test(compact)) return false;
	const total = [...compact].reduce(
		(sum, character, index) =>
			sum + (character === "X" ? 10 : Number(character)) * (8 - index),
		0,
	);
	return total % 11 === 0;
}

function everyIdentifier(value: string, validate: (entry: string) => boolean) {
	return value
		.split(/[,;\n]+/u)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.every(validate);
}

export function normalizeAdminFieldValue(
	descriptor: AdminFieldDescriptor,
	input: string,
): { error?: string; value: string } {
	const value = input.trim();
	if (!value) return { value: "" };
	const { kind } = adminFieldContract(descriptor);

	if (kind === "bibliographic-date") {
		if (parseBibliographicDate(value).kind === "invalid") {
			return {
				error: "Enter a real date, month, year, season, or other date text.",
				value,
			};
		}
		return { value };
	}
	if (kind === "access-date") {
		return isAccessDate(value)
			? { value }
			: { error: "Enter a real access date.", value };
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
	if (kind === "doi") {
		const doi = normalizeDoi(value);
		return doi
			? { value: doi }
			: { error: "Enter a valid DOI, such as 10.1000/example.", value };
	}
	if (kind === "isbn" && !everyIdentifier(value, validIsbn)) {
		return { error: "Enter a valid ISBN-10 or ISBN-13.", value };
	}
	if (kind === "issn" && !everyIdentifier(value, validIssn)) {
		return { error: "Enter a valid ISSN.", value };
	}
	if (kind === "pmid" && !/^\d+$/u.test(value)) {
		return { error: "Enter the PMID as digits only.", value };
	}
	if (kind === "pmcid") {
		const normalized = value.toUpperCase().replace(/^PMC\s*/u, "");
		return /^\d+$/u.test(normalized)
			? { value: `PMC${normalized}` }
			: { error: "Enter a PMCID, such as PMC12345.", value };
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
