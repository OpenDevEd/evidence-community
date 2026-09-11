import { z } from "zod";
import { COUNTRIES } from "@/constants/misc";
import { COUNTRY_ALIASES } from "@/constants/country-aliases";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const countryFocusOptions = Object.entries(COUNTRIES)
	.map(([code, name]) => ({ code, name: regionNames.of(code) ?? name }))
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

const matchers = countryFocusOptions.map(({ code, name }) => {
	const terms = [
		...new Set([name, COUNTRIES[code], ...(COUNTRY_ALIASES[code] ?? [])]),
	];
	const alternatives = terms
		.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	return {
		code,
		pattern: new RegExp(
			`(?:^|[^\\p{L}\\p{N}])(?:${alternatives})(?=$|[^\\p{L}\\p{N}])`,
			"iu",
		),
	};
});

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
	const text = `${title ?? ""} ${abstractNote ?? ""}`;
	// Two-letter codes are ordinary words in prose. Match names and demonyms only.
	return matchers
		.filter(({ pattern }) => pattern.test(text))
		.map(({ code }) => code)
		.sort();
}

export function describeCountryFocus(value: unknown) {
	if (!Array.isArray(value)) return "Automatic";
	return value.length
		? `Manual: ${value.map((code) => countryFocusNames[code]).join(", ")}`
		: "Manual: no countries";
}
