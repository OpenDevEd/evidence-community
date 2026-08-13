export type BibliographicDateResult =
	| { kind: "empty"; raw: "" }
	| { kind: "invalid"; raw: string }
	| { kind: "literal"; raw: string }
	| {
			isoDate?: string;
			kind: "parsed";
			precision: "day" | "month" | "season" | "year";
			raw: string;
			sortKey: number;
			year: number;
	  };

const ISO_LIKE_PATTERN = /^([12]\d{3})(?:-(\d{2})(?:-(\d{2}))?)?$/u;
const SEASON_PATTERN = /^(spring|summer|autumn|fall|winter)\s+([12]\d{3})$/iu;
const SEASON_MONTH = {
	spring: 3,
	summer: 6,
	autumn: 9,
	fall: 9,
	winter: 12,
} as const;

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

	const iso = ISO_LIKE_PATTERN.exec(raw);
	if (iso) {
		const year = Number(iso[1]);
		const month = iso[2] ? Number(iso[2]) : null;
		const day = iso[3] ? Number(iso[3]) : null;
		if (month === null) {
			return {
				kind: "parsed",
				precision: "year",
				raw,
				sortKey: year * 10_000,
				year,
			};
		}
		if (month < 1 || month > 12) return { kind: "invalid", raw };
		if (day === null) {
			return {
				kind: "parsed",
				precision: "month",
				raw,
				sortKey: year * 10_000 + month * 100,
				year,
			};
		}
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

	const season = SEASON_PATTERN.exec(raw);
	if (season) {
		const year = Number(season[2]);
		const month = SEASON_MONTH[
			season[1]!.toLowerCase() as keyof typeof SEASON_MONTH
		];
		return {
			kind: "parsed",
			precision: "season",
			raw,
			sortKey: year * 10_000 + month * 100,
			year,
		};
	}

	if (/^[12]\d{3}-\d/u.test(raw)) return { kind: "invalid", raw };
	return { kind: "literal", raw };
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
