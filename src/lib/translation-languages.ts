/** Languages records can be translated into: the world's most spoken, and the languages of the regions the libraries cover. */
export const TRANSLATION_LANGUAGE_CODES = [
	"af", "ak", "am", "ar", "bn", "cs", "da", "de", "el", "en", "es", "fa", "ff", "fi", "fil", "fr", "gu", "ha", "he",
	"hi", "hu", "id", "ig", "it", "ja", "km", "kn", "ko", "lg", "ln", "mg", "ml", "mr", "ms", "my", "ne", "nl", "no",
	"ny", "om", "pa", "pl", "ps", "pt", "rn", "ro", "ru", "rw", "si", "sn", "so", "st", "sv", "sw", "ta", "te", "th",
	"ti", "tn", "tr", "uk", "ur", "vi", "wo", "xh", "yo", "zh", "zu",
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGE_CODES)[number];

export type TranslationPart = "title" | "abstract";

/** One record's part in one language, as the server sends it and the browser stores it. */
export type RecordTranslation = {
	/** Fingerprint of the original text it was made from. */
	fingerprint: string;
	/** Empty when `same`. */
	text: string;
	/** The original is already in the language. */
	same: boolean;
	/** The original's language, ISO 639-1; titles only. */
	source: string | null;
};

/** A page's titles go in one request; its abstracts in batches this size, side by side. */
export const TITLES_PER_REQUEST = 20;
export const ABSTRACTS_PER_REQUEST = 5;
