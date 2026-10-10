import { Marked, type Token } from "marked";
import { z } from "zod";
import { AdminValidationError } from "@/lib/admin/errors";
import type { DigestDraft } from "./types";

// The same limits the writer's own text is held to.
export const digestDraftSchema = z.object({
  title: z.string().trim().min(1, "Give the digest a title.").max(200),
  summary: z.string().trim().min(1, "Give the digest a summary.").max(1000),
  markdown: z.string().trim().min(1, "The digest has no text.").max(50_000),
  note: z.string().trim().max(2000),
}).strict();

const CITATION = /^\/lib\/([A-Z0-9]{8})$/;
const lexer = new Marked({ gfm: true });

/**
 * What a digest's text may hold: second-level headings, paragraphs, bold, and links to this library's records.
 * That is all the writer produces and all the page and the email are laid out for. Anything else a person pastes in,
 * such as an image, a table, raw HTML or a link elsewhere, is refused with the reason.
 */
function refused(token: Token): string | null {
  switch (token.type) {
    case "space": case "text": case "escape": case "br": return null;
    case "paragraph": case "strong": return first(token.tokens);
    case "heading": return token.depth === 2 ? first(token.tokens) : "Use one level of heading.";
    case "link": return CITATION.test(token.href) ? first(token.tokens) : "A link must point to a publication in this library.";
    case "html": return "Remove the HTML.";
    case "image": return "A digest cannot hold images.";
    default: return "Use headings, paragraphs, bold and citations only.";
  }
}
const first = (tokens: Token[] | undefined): string | null => (tokens ?? []).map(refused).find(reason => reason !== null) ?? null;

function cited(tokens: Token[] | undefined): string[] {
  return (tokens ?? []).flatMap(token => [
    ...(token.type === "link" ? [CITATION.exec(token.href)?.[1]].filter(key => key !== undefined) : []),
    ...cited("tokens" in token ? token.tokens : undefined),
  ]);
}

/** The record keys a digest's text cites, in order, each once. */
export function citedKeys(markdown: string) {
  return [...new Set(cited(lexer.lexer(markdown)))];
}

/** A person's text for a digest, trimmed and checked. The title and summary are one line of plain text each. */
export function checkedDigestDraft(input: unknown): Required<DigestDraft> {
  const draft = digestDraftSchema.parse(input);
  for (const [field, label] of [["title", "title"], ["summary", "summary"]] as const) {
    if (/[\r\n]/.test(draft[field])) throw new AdminValidationError(`Keep the ${label} on one line.`, { [field]: "Remove the line break." });
  }
  const reason = first(lexer.lexer(draft.markdown));
  if (reason) throw new AdminValidationError(reason, { markdown: reason });
  return draft;
}
