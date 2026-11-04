import { beforeEach, expect, it, vi } from "vitest";

const pdf = new TextEncoder().encode("%PDF-1.7 body");
const html = new TextEncoder().encode("<html><body>Please sign in</body></html>");
const answers = new Map<string, () => Promise<{ data: Uint8Array; contentType: string; url: URL }>>();
const requested: string[] = [];
vi.mock("@/lib/public-fetch", () => ({
	fetchPublicFile: vi.fn(async (url: URL) => {
		requested.push(url.href);
		const answer = answers.get(url.href);
		if (!answer) throw new Error(`Download returned 404`);
		return answer();
	}),
}));
const { downloadAnyCopy } = await import("@/lib/source-ingestion/openalex/pdf-download");

const file = (data: Uint8Array, contentType: string) => (url: string) => async () => ({ data, contentType, url: new URL(url) });
// The connection that failed names its host, as publicRequest does; after a redirect it is another host.
const refused = (host: string) => async () => {
	throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" }, host });
};
const unpaywall = (locations: object[]) => async () => ({ data: new TextEncoder().encode(JSON.stringify({ oa_locations: locations })), contentType: "application/json", url: new URL("https://api.unpaywall.org") });

beforeEach(() => {
	answers.clear();
	requested.length = 0;
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

it("keeps the chosen link when it is a PDF and asks nobody else", async () => {
	answers.set("https://publisher.example/a.pdf", file(pdf, "application/pdf")("https://publisher.example/a.pdf"));
	const bytes = await downloadAnyCopy("https://publisher.example/a.pdf", { otherCopies: ["https://repo.example/a.pdf"], doi: "10.1/a" }, 1_000_000);
	expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.7 body");
	expect(requested).toEqual(["https://publisher.example/a.pdf"]);
});

it("tries the other open copies, then Unpaywall's, and publishes the first PDF", async () => {
	answers.set("https://publisher.example/b.pdf", file(html, "text/html")("https://publisher.example/b.pdf"));
	answers.set("https://api.unpaywall.org/v2/10.1%2Fb?email=support%40openscholar.ai", unpaywall([{ url_for_pdf: "https://mirror.example/b.pdf" }]));
	answers.set("https://mirror.example/b.pdf", file(pdf, "application/pdf")("https://mirror.example/b.pdf"));
	const bytes = await downloadAnyCopy("https://publisher.example/b.pdf", { otherCopies: ["https://repo.example/b.pdf"], doi: "10.1/b" }, 1_000_000);
	expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.7 body");
	expect(requested).toEqual([
		"https://publisher.example/b.pdf",
		"https://repo.example/b.pdf",
		"https://api.unpaywall.org/v2/10.1%2Fb?email=support%40openscholar.ai",
		"https://mirror.example/b.pdf",
	]);
});

it("reports what the chosen link did when no copy is a PDF", async () => {
	answers.set("https://publisher.example/c.pdf", file(html, "text/html")("https://publisher.example/c.pdf"));
	const bytes = await downloadAnyCopy("https://publisher.example/c.pdf", { otherCopies: ["https://repo.example/c.pdf"] }, 1_000_000);
	expect(new TextDecoder().decode(bytes)).toContain("Please sign in");
	await expect(downloadAnyCopy("https://publisher.example/missing.pdf", {}, 1_000_000)).rejects.toThrow("Download returned 404");
});

it("skips a host after three refused connections, and tries it again once it answers", async () => {
	for (const name of ["1", "2", "3", "4"]) answers.set(`https://dead.example/${name}.pdf`, refused("dead.example"));
	for (const name of ["1", "2", "3"]) await expect(downloadAnyCopy(`https://dead.example/${name}.pdf`, {}, 1_000_000)).rejects.toThrow("fetch failed");
	requested.length = 0;
	await expect(downloadAnyCopy("https://dead.example/4.pdf", {}, 1_000_000)).rejects.toThrow("dead.example did not accept connections");
	expect(requested).toEqual([]);

	// A host that answers, even with an error, is counted as reachable again.
	answers.set("https://flaky.example/1.pdf", refused("flaky.example"));
	answers.set("https://flaky.example/2.pdf", refused("flaky.example"));
	await expect(downloadAnyCopy("https://flaky.example/1.pdf", {}, 1_000_000)).rejects.toThrow("fetch failed");
	await expect(downloadAnyCopy("https://flaky.example/2.pdf", {}, 1_000_000)).rejects.toThrow("fetch failed");
	await expect(downloadAnyCopy("https://flaky.example/3.pdf", {}, 1_000_000)).rejects.toThrow("Download returned 404");
	answers.set("https://flaky.example/4.pdf", refused("flaky.example"));
	await expect(downloadAnyCopy("https://flaky.example/4.pdf", {}, 1_000_000)).rejects.toThrow("fetch failed");
});

it("counts refusals that happen at the same time, and blames a redirect's target rather than the link's host", async () => {
	for (const name of ["1", "2", "3", "4"]) answers.set(`https://busy.example/${name}.pdf`, refused("busy.example"));
	await Promise.all(["1", "2", "3"].map((name) => expect(downloadAnyCopy(`https://busy.example/${name}.pdf`, {}, 1_000_000)).rejects.toThrow("fetch failed")));
	await expect(downloadAnyCopy("https://busy.example/4.pdf", {}, 1_000_000)).rejects.toThrow("busy.example did not accept connections");

	for (const name of ["1", "2", "3"]) answers.set(`https://repository.example/${name}.pdf`, refused("storage.example"));
	for (const name of ["1", "2", "3"]) await expect(downloadAnyCopy(`https://repository.example/${name}.pdf`, {}, 1_000_000)).rejects.toThrow("fetch failed");
	answers.set("https://repository.example/4.pdf", file(pdf, "application/pdf")("https://repository.example/4.pdf"));
	expect(new TextDecoder().decode(await downloadAnyCopy("https://repository.example/4.pdf", {}, 1_000_000))).toBe("%PDF-1.7 body");
});

it("sends at most four fallback requests to one host at a time", async () => {
	let running = 0, most = 0;
	for (let index = 0; index < 6; index++) {
		answers.set(`https://blocked.example/${index}.pdf`, file(html, "text/html")(`https://blocked.example/${index}.pdf`));
		answers.set(`https://mirror.example/${index}.pdf`, async () => {
			running++;
			most = Math.max(most, running);
			await new Promise((resolve) => setTimeout(resolve, 20));
			running--;
			return { data: pdf, contentType: "application/pdf", url: new URL(`https://mirror.example/${index}.pdf`) };
		});
	}
	await Promise.all(Array.from({ length: 6 }, (_, index) => downloadAnyCopy(`https://blocked.example/${index}.pdf`, { otherCopies: [`https://mirror.example/${index}.pdf`] }, 1_000_000)));
	expect(most).toBe(4);
});
