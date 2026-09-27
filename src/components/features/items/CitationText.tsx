import { domToReact } from "html-react-parser";
import type { FormattedCitation } from "@/lib/citation-formats";
import { citationHtmlNodes } from "@/lib/citation-html";

export function CitationText({ citation }: { citation: FormattedCitation }) {
  return citation.html === null ? (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs">{citation.text}</pre>
  ) : (
    <div className="leading-relaxed [overflow-wrap:anywhere] [&_a]:text-link [&_a:hover]:underline [&_a:focus-visible]:underline [&_.csl-left-margin]:float-left [&_.csl-left-margin]:mr-2 [&_.csl-right-inline]:overflow-hidden [&_.csl-indent]:ml-4 [&_.csl-entry]:flow-root">
      {domToReact(citationHtmlNodes(citation.html))}
    </div>
  );
}
