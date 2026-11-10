import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { joinStandingOf } from "@/lib/readers/join-standing";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

/** A community whose OpenScholar answers `answer()` each time it is asked, and what it was asked. */
function community(libraryId: string, answer: () => Response | Promise<Response>) {
	const asked: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
	vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
		asked.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
		return answer();
	}));
	const config = { authentication: { openScholar: { convexSiteUrl: "https://openscholar.example", libraryId, machineCredential: "els_secret" } } } as LibraryServerConfig;
	return { config, asked };
}

it("asks OpenScholar where a reader stands with joining, reuses the answer for a minute, and asks again when told to", async () => {
	vi.useFakeTimers();
	let join = "open";
	const { config, asked } = community("library-asks", () => Response.json({ join }));
	expect(await joinStandingOf(config, "user_1")).toBe("open");
	expect(asked[0]).toMatchObject({ url: "https://openscholar.example/api/v1/evidence-libraries/join-standing", headers: { Authorization: "Bearer els_secret", "OpenScholar-Contract": "1" }, body: { libraryId: "library-asks", clerkUserId: "user_1" } });
	// They apply; the page they come back to asks afresh, where an ordinary page would still be told the last answer.
	join = "waiting";
	expect(await joinStandingOf(config, "user_1")).toBe("open");
	expect(await joinStandingOf(config, "user_1", { fresh: true })).toBe("waiting");
	// A visitor who isn't signed in is asked about without a reader, and answered apart from any reader.
	expect(await joinStandingOf(config, null)).toBe("waiting");
	expect(asked.at(-1)?.body).toEqual({ libraryId: "library-asks" });
	// After a minute, the next page asks again.
	join = "closed";
	vi.advanceTimersByTime(61_000);
	expect(await joinStandingOf(config, "user_1")).toBe("closed");
	expect(asked).toHaveLength(4);
});

it("keeps OpenScholar's last answer when it can't be asked, and offers Join when it never answered", async () => {
	vi.useFakeTimers();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	let reachable = true;
	const { config } = community("library-down", () => (reachable ? Response.json({ join: "closed" }) : new Response("no", { status: 503 })));
	expect(await joinStandingOf(config, null)).toBe("closed");
	reachable = false;
	vi.advanceTimersByTime(61_000);
	expect(await joinStandingOf(config, null)).toBe("closed");
	// A reader it never answered about: OpenScholar's own page says where they stand.
	expect(await joinStandingOf(config, "user_new")).toBe("open");
});
