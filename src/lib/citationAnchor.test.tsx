import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CitationDoiLink from "../components/features/items/CitationDoiLink";

test("renders a normalized DOI as an external anchor", () => {
	const output = renderToStaticMarkup(
		<CitationDoiLink
			link={{
				provider: "crossref",
				kind: "doi",
				label: "Crossref DOI",
				value: "10.1234/example",
				url: "https://doi.org/10.1234/example",
			}}
			className="text-base text-wrap-anywhere"
		/>,
	);

	assert.match(output, /^<a /);
	assert.match(output, /href="https:\/\/doi\.org\/10\.1234\/example"/);
	assert.match(output, /target="_blank"/);
	assert.match(output, /rel="noopener noreferrer"/);
	assert.match(
		output,
		/class="text-link_light transition-colors hover:underline dark:text-link text-base text-wrap-anywhere"/,
	);
	assert.match(
		output,
		/>https:\/\/doi\.org\/10\.1234\/example<\/a>$/,
	);
});
