import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ZoteroRichText from "../components/features/items/ZoteroRichText";
import { renderZoteroMarkup } from "./renderZoteroMarkup";
import {
	zoteroMarkupToPlainText,
	zoteroMarkupToSingleLine,
} from "./zoteroMarkup";

function render(markup: string): string {
	return renderToStaticMarkup(<>{renderZoteroMarkup(markup)}</>);
}

test("renders the Zotero rich-text tag set semantically", () => {
	assert.equal(
		render("<i>italic <b>and bold</b></i> H<sub>2</sub>O x<sup>2</sup>"),
		"<em>italic <strong>and bold</strong></em> H<sub>2</sub>O x<sup>2</sup>",
	);
});

test("supports paragraphs, line breaks, entities, and Zotero small caps", () => {
	assert.equal(
		render(
			'<p>First &amp; second<br>line</p><p><span style="font-variant:small-caps;">Small caps</span></p>',
		),
		'<p>First &amp; second<br/>line</p><p><span class="zotero-small-caps">Small caps</span></p>',
	);
});

test("preserves blank-line paragraphs in the rendered component", () => {
	assert.equal(
		renderToStaticMarkup(
			<ZoteroRichText markup={"First paragraph.\n\n<i>Italic paragraph.</i>"} />,
		),
		'<div class="zotero-rich-text">First paragraph.\n\n<em>Italic paragraph.</em></div>',
	);
});

test("removes executable elements, URLs, and all source attributes", () => {
	const output = render(
		'<i onclick="alert(1)" style="background:url(javascript:alert(2))">safe</i>' +
			'<a href="javascript:alert(3)">link text</a>' +
			'<img src=x onerror="alert(4)">' +
			'<svg onload="alert(5)"><text>svg text</text></svg>' +
			'<script>alert(6)</script><iframe srcdoc="<script>alert(7)</script>">frame text</iframe>',
	);

	assert.equal(output, "<em>safe</em>link text");
	assert.doesNotMatch(output, /javascript|onerror|onclick|onload|script|svg|iframe/i);
});

test("handles malformed nested markup safely", () => {
	const markup = "<i>open <b>nested</i> tail<script>hidden</script>";
	const output = render(markup);

	assert.equal(zoteroMarkupToSingleLine(markup), "open nested tail");
	assert.doesNotMatch(output, /<i>|<b>|script|hidden/i);
});

test("unwraps unsupported formatting while retaining safe text", () => {
	assert.equal(
		render(
			'<u>underlined</u><span class="nocase">No case changes</span>' +
				'<span style="font-variant:small-caps;color:red">No unsafe styles</span>',
		),
		"underlined<span>No case changes</span><span>No unsafe styles</span>",
	);
});

test("produces decoded plain-text projections without markup", () => {
	const markup = "<p>First &amp; second</p><p><i>Italic</i><br>line</p>";

	assert.equal(zoteroMarkupToPlainText(markup), "First & second\n\nItalic\nline");
	assert.equal(zoteroMarkupToSingleLine(markup), "First & second Italic line");
});

test("drops executable content from plain-text projections", () => {
	assert.equal(
		zoteroMarkupToSingleLine(
			"Visible<script>hidden</script><style>hidden</style><iframe>hidden</iframe>",
		),
		"Visible",
	);
});
