import { z } from "zod";
import { COUNTRIES } from "@/constants/misc";
import { COUNTRY_ALIASES, NOT_COUNTRY_PHRASES } from "@/constants/country-aliases";
import { abstractPlainText } from "@/lib/abstract-text";

function normalizeCountryText(text: string) {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[’‘ʼ]/g, "'")
		.replace(/\p{Pd}/gu, " ")
		.replace(/&/g, " and ")
		.replace(/\s+/g, " ")
		.trim();
}

export const countryFocusOptions = Object.entries(COUNTRIES)
	.map(([code, name]) => ({
		code,
		name,
		terms: [
			...new Set(
				[name, ...(COUNTRY_ALIASES[code] ?? [])].map(
					normalizeCountryText,
				),
			),
		],
	}))
	.sort((left, right) => left.name.localeCompare(right.name));
export const countryFocusNames = Object.fromEntries(
	countryFocusOptions.map(({ code, name }) => [code, name]),
);

export function findCountryFocusOptions(
	query: string,
	selected: readonly string[] = [],
) {
	const term = normalizeCountryText(query);
	return countryFocusOptions.filter(
		({ code, terms }) =>
			!selected.includes(code) &&
			(code.toLowerCase().includes(term) ||
				terms.some((name) => name.includes(term))),
	);
}

/** Null or absent means automatic. An empty array is an intentional manual selection. */
export const countryFocusSchema = z
	.array(
		z
			.string()
			.trim()
			.toUpperCase()
			.refine(
				(code) => Object.hasOwn(COUNTRIES, code),
				"Choose a country from the list.",
			),
	)
	.max(Object.keys(COUNTRIES).length)
	.transform((codes) => [...new Set(codes)].sort())
	.nullable();

function countryTerms() {
	const candidates = new Map<string, Set<string>>();
	for (const { code, terms } of countryFocusOptions) {
		for (const term of terms) {
			const codes = candidates.get(term) ?? new Set<string>();
			codes.add(code);
			candidates.set(term, codes);
		}
	}
	// Ambiguous demonyms cannot identify a country. English usually names a
	// language used worldwide; keep it in picker search, not automatic focus.
	return new Map(
		[...candidates]
			.filter(([term, codes]) => codes.size === 1 && term !== "english")
			.map(([term, codes]) => [term, [...codes][0]!]),
	);
}
const codesByTerm = countryTerms();
const alternatives = [...codesByTerm.keys()]
	.sort((a, b) => b.length - a.length)
	.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");
// One pass from the left. Longest names consume the phrase first: South Sudan does not also mean Sudan. A phrase that
// names something else wins over a country word at the same place ("Guinea savannah"), but not over a country name that
// starts earlier ("Papua New Guinea savannah"). Only country names are captured.
const countryPattern = new RegExp(
	`(?:^|[^\\p{L}\\p{N}])(?:${NOT_COUNTRY_PHRASES.join("|")}|(${alternatives}))(?=$|[^\\p{L}\\p{N}])`,
	"giu",
);

export function resolveCountryFocus({
	title,
	abstractNote,
	countryFocus,
}: {
	title?: string | null;
	abstractNote?: string | null;
	countryFocus?: readonly string[] | null;
}) {
	if (countryFocus) return [...new Set(countryFocus)].sort();
	// Each field on its own, so no name or phrase runs from the title into the abstract.
	// Do not infer arbitrary ISO codes: "us", "in" and "to" are ordinary words.
	const codes = [title, abstractNote].flatMap((value) =>
		[...normalizeCountryText(abstractPlainText(value)).matchAll(countryPattern)]
			.filter((match) => match[1])
			.map((match) => codesByTerm.get(match[1].toLowerCase())!),
	);
	return [...new Set(codes)].sort();
}

export function describeCountryFocus(value: unknown) {
	if (!Array.isArray(value)) return "Automatic";
	return value.length
		? `Manual: ${value.map((code) => countryFocusNames[code]).join(", ")}`
		: "Manual: no countries";
}
