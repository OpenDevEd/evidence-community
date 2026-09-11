import { describe, expect, it } from "vitest";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { libraryRequestMessage } from "@/lib/emails/request";
import { maximalLibraryConfig } from "../fixtures/library-config";

describe("request email content safety", () => {
	it("keeps reader markup inert and only links HTTP publications", () => {
		const description = '<script>alert("test")</script>\nSecond paragraph';
		const safeLink = "https://example.org/lib/ABCD1234?one=1&two=2";
		const unsafeLink = "javascript:alert(1)";
		const message = libraryRequestMessage(libraryConfigSchema.parse(maximalLibraryConfig), {
			email: "reader@example.org",
			description,
			links: [safeLink, unsafeLink],
		});
		expect(message.html).not.toContain("<script>");
		expect(message.html).toContain("&lt;script&gt;");
		expect(message.html).toContain("&lt;/script&gt;<br>Second paragraph");
		expect(message.html).toContain('href="https://example.org/lib/ABCD1234?one=1&amp;two=2"');
		expect(message.html).not.toContain('href="javascript:');
		expect(message.text).toContain(description);
		expect(message.text).toContain(safeLink);
		expect(message.text).toContain(unsafeLink);
	});
});
