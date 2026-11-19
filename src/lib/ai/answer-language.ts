/** Locales whose code isn't a language tag Intl knows. */
const LOCALE_LANGUAGE: Record<string, string> = { cn: "zh" };

/** The page language's name in English, which models follow more reliably than a locale code. */
export function answerLanguageName(locale: string) {
	const code = LOCALE_LANGUAGE[locale] ?? locale;
	try {
		return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** Answers follow the page's language, not the publication's or the question's. */
export function answerLanguageInstruction(locale: string) {
	return `Write your whole answer in ${answerLanguageName(locale)}, whatever language the publication, its PDF or the question is in. Keep verbatim quotations in their original language.`;
}
