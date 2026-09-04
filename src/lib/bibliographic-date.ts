export type BibliographicDateResult =
	| { kind: "empty"; raw: "" }
	| { kind: "invalid"; raw: string }
	| {
			isoDate?: string;
			kind: "parsed";
			precision: "day" | "month" | "year";
			raw: string;
			sortKey: number;
			year: number;
	  };

const YEAR_PATTERN = /^[12]\d{3}$/u;
const MONTH_PATTERN = /^([12]\d{3})-(\d{2})$/u;
const EXACT_DATE_PATTERN = /^([12]\d{3})-(\d{2})-(\d{2})$/u;

function validCalendarDate(year: number, month: number, day: number) {
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function parseBibliographicDate(value: string): BibliographicDateResult {
	const raw = value.trim();
	if (!raw) return { kind: "empty", raw: "" };

	if (YEAR_PATTERN.test(raw)) {
		const year = Number(raw);
		return {
			kind: "parsed",
			precision: "year",
			raw,
			sortKey: year * 10_000,
			year,
		};
	}

	const monthDate = MONTH_PATTERN.exec(raw);
	if (monthDate) {
		const year = Number(monthDate[1]);
		const month = Number(monthDate[2]);
		if (month < 1 || month > 12) return { kind: "invalid", raw };
		return {
			kind: "parsed",
			precision: "month",
			raw,
			sortKey: year * 10_000 + month * 100,
			year,
		};
	}

	const exactDate = EXACT_DATE_PATTERN.exec(raw);
	if (exactDate) {
		const year = Number(exactDate[1]);
		const month = Number(exactDate[2]);
		const day = Number(exactDate[3]);
		if (!validCalendarDate(year, month, day)) {
			return { kind: "invalid", raw };
		}
		return {
			isoDate: raw,
			kind: "parsed",
			precision: "day",
			raw,
			sortKey: year * 10_000 + month * 100 + day,
			year,
		};
	}

	return { kind: "invalid", raw };
}

export function bibliographicDateSearchFields(value: string | null) {
	if (!value) return {};
	const parsed = parseBibliographicDate(value);
	if (parsed.kind !== "parsed") return {};
	return {
		...(parsed.isoDate ? { datePublished: parsed.isoDate } : {}),
		dateSortKey: parsed.sortKey,
		year: String(parsed.year),
	};
}
