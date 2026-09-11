import { z } from "zod";
import { COUNTRIES } from "@/constants/misc";
import { COUNTRY_ALIASES } from "@/constants/country-aliases";
import { abstractPlainText } from "@/lib/abstract-text";

export const countryFocusOptions = Object.entries(COUNTRIES)
	.map(([code, name]) => ({ code, name }))
	.sort((left, right) => left.name.localeCompare(right.name));
export const countryFocusNames = Object.fromEntries(
	countryFocusOptions.map(({ code, name }) => [code, name]),
);

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
	for (const { code, name } of countryFocusOptions) {
		for (const term of [name, ...(COUNTRY_ALIASES[code] ?? [])]) {
			const key = term.toLowerCase();
			const codes = candidates.get(key) ?? new Set<string>();
			codes.add(code);
			candidates.set(key, codes);
		}
	}
	// An ambiguous demonym cannot tell us which country the item means.
	return new Map(
		[...candidates]
			.filter(([, codes]) => codes.size === 1)
			.map(([term, codes]) => [term, [...codes][0]!]),
	);
}
const codesByTerm = countryTerms();
const alternatives = [...codesByTerm.keys()]
	.sort((a, b) => b.length - a.length)
	.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");
// Longest names consume the phrase first: South Sudan does not also mean Sudan.
const countryPattern = new RegExp(
	`(?:^|[^\\p{L}\\p{N}])(${alternatives})(?=$|[^\\p{L}\\p{N}])`,
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
	const text = `${abstractPlainText(title)}\n${abstractPlainText(abstractNote)}`;
	// Two-letter codes are ordinary words in prose. Match names and demonyms only.
	return [
		...new Set(
			[...text.matchAll(countryPattern)].map(
				(match) => codesByTerm.get(match[1].toLowerCase())!,
			),
		),
	].sort();
}

export function describeCountryFocus(value: unknown) {
	if (!Array.isArray(value)) return "Automatic";
	return value.length
		? `Manual: ${value.map((code) => countryFocusNames[code]).join(", ")}`
		: "Manual: no countries";
}
