export type Part = {id: string; title: string; body: string; /** Publications the section cites, each counted once. */ cited: number};

/** A heading's text without inline Markdown: `**Schools**` reads Schools. */
const plainHeading = (text: string) => text.replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2").trim();

/** The publications a section links to, each once, whether or not a link carries a title. */
const citedKeys = (body: string) => new Set(Array.from(body.matchAll(/\]\(\/lib\/([A-Za-z0-9]+)/g), match => match[1]));

/** The edition's text cut at its subject headings, so each subject is a section the contents can point to. */
export function editionParts(markdown: string): {intro: string; parts: Part[]} {
  // An underlined level-two heading is the same heading as one written with ##.
  const [intro, ...chunks] = markdown.replace(/^(?!#)(\S.*)\n-{2,}[ \t]*$/gm, "## $1").split(/^## /m);
  const taken = new Set<string>();
  return {intro: intro.trim(), parts: chunks.map(chunk => {
    const end = chunk.indexOf("\n");
    const title = plainHeading(end < 0 ? chunk : chunk.slice(0, end));
    const body = end < 0 ? "" : chunk.slice(end + 1);
    const base = `section-${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return {id, title, body, cited: citedKeys(body).size};
  })};
}
