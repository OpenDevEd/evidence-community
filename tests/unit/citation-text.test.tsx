// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { CitationText } from "@/components/features/items/CitationText";
import { formatCitations } from "@/lib/citation-formatter";

function render(element: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  return { container, rerender: (next: ReactElement) => { container.innerHTML = renderToStaticMarkup(next); } };
}
const record = {
  id: "rich", "citation-key": "rich", type: "article-journal", title: "Evidence & education",
  author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2026]] },
  "container-title": "Journal of Education", volume: "42", DOI: "10.1234/evidence",
};

it("renders the style's italics and a navigable DOI without adding markup to copied text", async () => {
  const { apa } = await formatCitations(record, "en-GB");
  const { container } = render(createElement(CitationText, { citation: apa }));
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://doi.org/10.1234/evidence");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(container.querySelector("i")?.textContent).toBe("Journal of Education");
  expect(container.textContent).toBe(apa.text);
});

it("keeps URL query strings intact and punctuation outside the link", async () => {
  const URL = "https://example.org/evidence?country=KE&year=2026";
  const { apa } = await formatCitations({ ...record, DOI: undefined, URL }, "en-GB");
  const { container } = render(createElement(CitationText, { citation: apa }));
  expect(container.querySelector("a")!.getAttribute("href")).toBe(URL);
});

it("renders bibliographic metadata as text and rejects executable markup and link schemes", async () => {
  const { apa } = await formatCitations({ ...record, title: 'Evidence <img src=x onerror="alert(1)">' }, "en-GB");
  const { container, rerender } = render(createElement(CitationText, { citation: apa }));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  rerender(createElement(CitationText, { citation: {
    text: "Unsafe link Safe link",
    html: '<script>alert(1)</script><iframe src="https://example.org"></iframe><a href="javascript:alert(1)">Unsafe link</a> <a href="https://example.org" onclick="alert(1)">Safe link</a><span style="position:fixed;font-variant:small-caps" onmouseover="alert(1)">Journal</span>',
  } }));
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.querySelector("a")!.getAttribute("href")).toBe("https://example.org/");
  expect(container.querySelector("script,iframe,[onclick],[onmouseover]")).toBeNull();
  expect(container.querySelector("span")?.style.position).toBe("");
  expect(container.querySelector("span")?.style.fontVariant).toBe("small-caps");
});

it("keeps BibTeX as literal copyable source", () => {
  const text = '@article{example, title={A <i>literal</i> title}, url={https://example.org}}';
  const { container } = render(createElement(CitationText, { citation: { text, html: null } }));
  expect(container.textContent).toBe(text);
  expect(container.querySelector("a,i")).toBeNull();
});


it("keeps the configured library URL clickable and in the copied citation", async () => {
  const url = "https://evidence-test-library.example.org/lib/ARTICLE1";
  const { apa } = await formatCitations(record, "en-GB", url);
  const { container } = render(createElement(CitationText, { citation: apa }));
  expect(container.querySelector(`a[href="${url}"]`)!.getAttribute("href")).toBe(url);
  expect(container.textContent).toBe(apa.text);
});


it("links a bare DOI in Vancouver without changing the style's visible label", async () => {
  const { vancouver } = await formatCitations(record, "en-GB");
  const { container } = render(createElement(CitationText, { citation: vancouver }));
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://doi.org/10.1234/evidence");
  expect(link.textContent).toBe("10.1234/evidence");
});


it("exports the same safe typography and links in a standalone HTML document", async () => {
 const { buildCitationDocument } = await import("@/lib/citation-document");
 const { apa } = await formatCitations(record, "en-GB");
 const doc = new DOMParser().parseFromString(buildCitationDocument(apa, "html", "APA 7"), "text/html");
 expect(doc.querySelector("i")?.textContent).toBe("Journal of Education");
 expect(doc.querySelector("a")?.getAttribute("href")).toBe("https://doi.org/10.1234/evidence");
 expect(doc.body.textContent).toBe(apa.text);
 const unsafe = new DOMParser().parseFromString(buildCitationDocument({ text: "Safe text", html: '<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">Safe text</a>' }, "html", "<script>title</script>"), "text/html");
 expect(unsafe.querySelector("script,[onclick],a")).toBeNull();
 expect(unsafe.body.textContent).toBe("Safe text");
 expect(buildCitationDocument(apa, "txt", "APA 7")).toBe(apa.text);
});
