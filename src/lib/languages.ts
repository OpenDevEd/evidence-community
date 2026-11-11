const names = new Intl.DisplayNames(["en"], { fallback: "none", type: "language" });
const letters = [..."abcdefghijklmnopqrstuvwxyz"];

/**
 * Every language with a two-letter ISO 639 code, by its English name: the ones
 * the record editor offers, and the form Crossref and Zenodo take.
 */
export const LANGUAGES = letters
	.flatMap((first) => letters.map((second) => first + second))
	.flatMap((code) => {
		const name = names.of(code);
		// A retired code names the same language as its successor: "iw" is "he".
		return name && Intl.getCanonicalLocales(code)[0] === code ? [{ code, name }] : [];
	})
	// One row a language: Twi ("tw") is named Akan, as "ak" is.
	.filter((language, index, all) => all.findIndex((other) => other.name === language.name) === index)
	.sort((a, b) => a.name.localeCompare(b.name, "en"));

const offered = new Map(LANGUAGES.map(({ code, name }) => [name, code]));

const codesByName = new Map<number, Map<string, string>>();
/** Language codes of one length by their English names: "swahili" to "sw", "cebuano" to "ceb". */
function languageCodes(length: 2 | 3) {
	const known = codesByName.get(length);
	if (known) return known;
	const codes = length === 2 ? letters.flatMap((first) => letters.map((second) => first + second)) : letters.flatMap((first) => letters.flatMap((second) => letters.map((third) => first + second + third)));
	const found = new Map(codes.flatMap((code) => {
		const name = names.of(code);
		return name ? [[name.toLowerCase(), Intl.getCanonicalLocales(code)[0]!] as const] : [];
	}));
	codesByName.set(length, found);
	return found;
}

/**
 * A record's language as XMP writes it: the tag it holds ("en-GB"), or the
 * code of the language it names ("English"); otherwise none. Tags prefer
 * two-letter codes, and the three-letter list takes a moment to build, so
 * it is read only for a name the two-letter one doesn't have.
 */
export const languageTag = (value: string) => (!value || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) ? value : (languageCodes(2).get(value.toLowerCase()) ?? languageCodes(3).get(value.toLowerCase()) ?? ""));

/**
 * The two-letter code of the language a value names or tags ("English",
 * "en-GB", "eng" are all "en"); "" when it is none of LANGUAGES.
 */
export function languageCode(value: string) {
	const tag = languageTag(value.trim());
	if (!tag) return "";
	try {
		const name = names.of(Intl.getCanonicalLocales(tag)[0]!.split("-")[0]!);
		return (name && offered.get(name)) ?? "";
	} catch {
		return "";
	}
}
