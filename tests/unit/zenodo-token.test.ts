import { afterEach, describe, expect, it, vi } from "vitest";
import { ZenodoReconnectError, forgetZenodoToken, zenodoToken } from "@/lib/publication/zenodo-token";

const openScholar = { convexSiteUrl: "https://openscholar.test", libraryId: "lib_1", machineCredential: "machine" };
const config = (zenodo: Record<string, unknown>) => ({ services: { publication: { zenodo: { enabled: true, account: "token", ...zenodo } } }, authentication: { openScholar } }) as never;

afterEach(() => forgetZenodoToken());

describe("the Zenodo token a deposit is made with", () => {
	it("is the configuration's for a community's own token", async () => {
		expect(await zenodoToken(config({ token: "own-token" }))).toBe("own-token");
	});

	it("comes from Openscholar for its owner's connected account, kept until it nears its end", async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify({ accessToken: "connected", expiresAt: 10 * 60 * 1000 }), { status: 200 }));
		const owned = config({ account: "openscholar" });
		expect(await zenodoToken(owned, { fetch, now: () => 0 })).toBe("connected");
		expect(await zenodoToken(owned, { fetch, now: () => 60_000 })).toBe("connected");
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe("https://openscholar.test/api/v1/evidence-libraries/zenodo-token");
		expect(JSON.parse(String(init.body))).toEqual({ libraryId: "lib_1" });
		// Within five minutes of its end it is asked for again.
		await zenodoToken(owned, { fetch, now: () => 6 * 60 * 1000 });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("says to reconnect when Openscholar no longer has the account", async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "zenodo_reconnect" } }), { status: 409 }));
		await expect(zenodoToken(config({ account: "openscholar" }), { fetch })).rejects.toBeInstanceOf(ZenodoReconnectError);
	});
});
