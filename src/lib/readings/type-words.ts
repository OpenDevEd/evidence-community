import type { StudyTypeKey } from "./study-types";

/** A hyphen of any kind, spaces or a line break, or nothing, as titles and PDFs join "meta" and "analysis". */
const JOIN = "[-\\u2010\\u2011\\u2012\\u2013]?\\s*";

/**
 * The words a record of these types has in its text, in English or the libraries' other languages. A meta-analysis or
 * a randomised trial says what it is, so a record without the words is not one. A record that has them may only
 * mention the design, which the AI decides.
 */
const TYPE_WORDS = {
	"meta-analysis": new RegExp(`m[eé]ta${JOIN}a?n[aá]l[iy][st]|meta${JOIN}分析|荟萃分析|元分析|تحليل\\S*\\s+(ال)?تلوي|मेटा${JOIN}विश्लेषण|uchambuzi${JOIN}meta`, "iu"),
	rct: /random|\bRCTs?\b|aleat[oó]ri|al[ée]atoire|zuf[äa]ll|随机|عشوائي|معش[اّ]|यादृच्छिक|nasibu/iu,
} satisfies Partial<Record<StudyTypeKey, RegExp>>;

/** The types whose words the record's title, abstract and PDF opening lack, so the AI is not offered them. */
export function ruledOutTypes(text: { title: string; abstract: string; pdf: string }): StudyTypeKey[] {
	const words = `${text.title}\n${text.abstract}\n${text.pdf}`;
	return (Object.keys(TYPE_WORDS) as (keyof typeof TYPE_WORDS)[]).filter((type) => !TYPE_WORDS[type].test(words));
}
