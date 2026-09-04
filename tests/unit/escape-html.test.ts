import { expect, it } from "vitest";

import { escapeHtml } from "@/lib/escape-html";

it("escapes every character that can open markup or end an attribute", () => {
	expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
		"&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;&amp;&lt;/a&gt;",
	);
});
