import { Marked, type Token } from "marked";
import { z } from "zod";
import { AdminValidationError } from "@/lib/admin/errors";
import type { DigestDraft } from "./types";

const MOST_TEXT = 50_000;
const TOO_LONG = "Keep the digest's text under 50,000 characters.";

// The same limits the writer's own text is held to.
export const digestDraftSchema = z.object({
  title: z.string().trim().min(1, "Give the digest a title.").max(200),
  summary: z.string().trim().min(1, "Give the digest a summary.").max(1000),
  markdown: z.string().trim().min(1, "The digest has no text.").max(MOST_TEXT),
  note: z.string().trim().max(2000),
}).strict();

const CITATION = /^\/lib\/([A-Z0-9]{8})$/;
const lexer = new Marked({ gfm: true });

// What a person may paste in that a digest cannot hold, with what to do about it.
const REFUSED: Record<string, string> = { html: "Remove the HTML.", image: "A digest cannot hold images." };
const PLAIN = new Set(["space", "text", "escape", "br"]);
// The reader's page draws these as cards and highlights where AI answers use them. A digest's email cannot.
const DIRECTIVE = /\[(RESOURCE|QUOTE|PAGE|SECTION)\b/;
const NESTED = new Set(["paragraph", "strong"]);

/**
 * What a digest's text may hold: second-level headings, paragraphs, bold, and links to this library's records.
 * That is all the writer produces and all the page and the email are laid out for. Anything else a person pastes in,
 * such as an image, a table, raw HTML or a link elsewhere, is refused with the reason.
 */
function refused(token: Token): string | null {
  return PLAIN.has(token.type) && DIRECTIVE.test(token.raw) ? "Cite a publication with the Cite button." : refusedMarkup(token);
}
function refusedMarkup(token: Token): string | null {
  if (PLAIN.has(token.type)) return null;
  if (NESTED.has(token.type)) return first("tokens" in token ? token.tokens : undefined);
  if (token.type === "heading") return token.depth === 2 ? first(token.tokens) : "Use one level of heading.";
  if (token.type === "link") return CITATION.test(token.href) ? first(token.tokens) : "A link must point to a publication in this library.";
  return REFUSED[token.type] ?? "Use headings, paragraphs, bold and citations only.";
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
  // Said in the editor's own word for the field: the schema would call it Markdown.
  const text = (input as { markdown?: unknown } | null)?.markdown;
  if (typeof text === "string" && text.trim().length > MOST_TEXT) throw new AdminValidationError(TOO_LONG, { markdown: TOO_LONG });
  const draft = digestDraftSchema.parse(input);
  for (const [field, label] of [["title", "title"], ["summary", "summary"]] as const) {
    if (/[\r\n]/.test(draft[field])) throw new AdminValidationError(`Keep the ${label} on one line.`, { [field]: "Remove the line break." });
  }
  const reason = first(lexer.lexer(draft.markdown));
  if (reason) throw new AdminValidationError(reason, { markdown: reason });
  return draft;
}
