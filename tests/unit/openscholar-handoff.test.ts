// A library hands records, a search or a collection to OpenScholar (plans/evidence-library-sources in OpenScholar).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: vi.fn() }));
const openScholar = { convexSiteUrl: "https://os.example.org", libraryId: "lib123", machineCredential: `els_${"a".repeat(43)}` };
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: async () => ({ authentication: { openScholar }, features: { readerAccounts: false } }) }));

import { POST } from "@/app/api/handoff/route";
import { searchOf } from "@/lib/openscholar/handoff";
import { loadSearchParams } from "@/lib/searchParams";

const handOff = (body: unknown) => POST(new NextRequest("https://library.example.org/api/handoff", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.unstubAllGlobals());

it("makes the hand-off at OpenScholar with the library's credential and answers where to send the reader", async () => {
	const fetched = vi.fn(async () => Response.json({ handoffId: "h1", url: "https://openscholar.example/from-library/h1", expiresAt: 1 }, { status: 201 }));
	vi.stubGlobal("fetch", fetched);
	const handoff = { from: "smartScreening", source: { records: ["AAAAAAAA", "BBBBBBBB"] }, fields: [{ label: "Randomized", type: "boolean", description: "Assigned at random?" }] };

	const response = await handOff(handoff);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ url: "https://openscholar.example/from-library/h1" });
	const [url, init] = fetched.mock.calls[0] as unknown as [URL, RequestInit];
	expect(String(url)).toBe("https://os.example.org/api/v1/evidence-libraries/handoffs");
	expect(init.headers).toMatchObject({ Authorization: `Bearer ${openScholar.machineCredential}`, "OpenScholar-Contract": "1" });
	// Nobody signed in to the library: OpenScholar asks whoever opens it.
	expect(JSON.parse(String(init.body))).toEqual({ libraryId: "lib123", ...handoff });
});

it("refuses what OpenScholar would, and says so when OpenScholar refuses", async () => {
	const fetched = vi.fn(async () => Response.json({ error: "invalid_service_credential" }, { status: 401 }));
	vi.stubGlobal("fetch", fetched);
	expect((await handOff({ from: "search", source: { records: ["not-a-key"] }, fields: [] })).status).toBe(400);
	expect((await handOff({ from: "search", source: { search: "search=tutoring", library: true }, fields: [] })).status).toBe(400);
	expect(fetched).not.toHaveBeenCalled();
	expect((await handOff({ from: "search", source: { search: "search=tutoring" }, fields: [] })).status).toBe(502);
});

it("hands a search over as its page writes it, without the page it was on", () => {
	const search = new URLSearchParams(searchOf(loadSearchParams(new URLSearchParams("search=tutoring&type=journalArticle&sort=desc&page=3"))));
	expect(Object.fromEntries(search)).toEqual({ search: "tutoring", type: "journalArticle", sort: "desc" });
	expect(searchOf(loadSearchParams(new URLSearchParams("page=2")))).toBe("");
});
