import { createHash } from "node:crypto";
import { abstractPlainText } from "@/lib/abstract-text";

export const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Jev reads 32K tokens; an abstract is cut well inside that, as OpenScholar cuts it. */
const ABSTRACT_CHARS = 3_000;

/** A record's text as Jev reads it: its title and the opening of its abstract. */
export const readingText = (title: string | null, abstractNote: string | null) => ({ title: title ?? "", abstract: abstractPlainText(abstractNote).slice(0, ABSTRACT_CHARS) });

/** What a reading was made from, so one made from text the record no longer has is known to be out of date. */
export const contentHashOf = (text: { title: string; abstract: string }) => hash(`${text.title}\n${text.abstract}`);
