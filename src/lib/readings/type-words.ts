import type { StudyTypeKey } from "./study-types";

/** A hyphen of any kind, a space, or nothing, as titles join "meta" and "analysis". */
const JOIN = "[-\\u2010\\u2011\\u2012\\u2013\\s]?";

/**
 * The words a call of these types needs in the record's text before it stands. A paper that is a meta-analysis or a
 * randomised trial says so, in English or the libraries' other languages; one that only mentions them may still not be
 * one, which the reading decides. Without the words, the call is uncertain.
 */
const TYPE_WORDS: Partial<Record<StudyTypeKey, RegExp>> = {
	"meta-analysis": new RegExp(`m[eé]ta${JOIN}a?n[aá]l[iy][st]|meta${JOIN}分析|荟萃分析|元分析|تحليل تلوي|मेटा${JOIN}विश्लेषण|uchambuzi${JOIN}meta`, "iu"),
	rct: /randomi[sz]|\bRCTs?\b|random(ly)? (assign|allocat)|aleatori[sz]ad|随机|عشوائي|यादृच्छिक|nasibu/iu,
};

/** Whether calls of this type need their words in the record's text. */
export const typeNeedsWords = (type: StudyTypeKey) => type in TYPE_WORDS;

/** Whether the record's title, abstract or PDF text has the words its type needs; null for a type that needs none. */
export function typeWordsFound(type: StudyTypeKey, text: { title: string; abstract: string; pdf: string }) {
	const words = TYPE_WORDS[type];
	return words ? words.test(`${text.title}\n${text.abstract}\n${text.pdf}`) : null;
}
