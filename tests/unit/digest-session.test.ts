import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  class AdminApiError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  }
  return { AdminApiError, saveAdminDigest: vi.fn(), moveAdminDigest: vi.fn() };
});
vi.mock("@/components/admin/admin-api", () => api);

import type { AdminDigest, AdminDigestWords } from "@/components/admin/admin-api";
import { DigestSession } from "@/components/admin/digest-session";

const words: AdminDigestWords = { title: "August", summary: "One study.", markdown: "A study.", note: "" };
const digest = (revision: number, text: AdminDigestWords = words) => ({ id: "edition", revision, state: "draft", words: text }) as AdminDigest;
/** A save the test finishes by hand, to hold it open while more is typed. */
function held() {
  let finish!: (value: AdminDigest) => void;
  const answer = new Promise<AdminDigest>((resolve) => { finish = resolve; });
  return { answer, finish };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("the text a person has in hand for a digest", () => {
  it("saves once, a moment after they stop typing, with all they typed", async () => {
    api.saveAdminDigest.mockResolvedValue(digest(4));
    const session = new DigestSession(digest(3), words);
    session.change({ title: "A" });
    await vi.advanceTimersByTimeAsync(500);
    session.change({ title: "Au" });
    session.change({ note: "Read this first." });
    expect(session.read().words).toMatchObject({ title: "Au", note: "Read this first." });
    await vi.advanceTimersByTimeAsync(699);
    expect(api.saveAdminDigest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveAdminDigest.mock.calls).toEqual([["edition", 3, { ...words, title: "Au", note: "Read this first." }]]);
    expect(session.read()).toMatchObject({ digest: { revision: 4 }, problem: null, stale: false });
  });

  it("sends what was typed during a save from the revision that save returned", async () => {
    const first = held();
    api.saveAdminDigest.mockReturnValueOnce(first.answer).mockResolvedValueOnce(digest(5));
    const session = new DigestSession(digest(3), words);
    session.change({ title: "First" });
    await vi.advanceTimersByTimeAsync(700);
    session.change({ title: "Second" });
    await vi.advanceTimersByTimeAsync(700);
    // One save at a time: the second waits for the first.
    expect(api.saveAdminDigest).toHaveBeenCalledTimes(1);
    first.finish(digest(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.saveAdminDigest.mock.calls[1]).toEqual(["edition", 4, { ...words, title: "Second" }]);
    expect(session.read().digest.revision).toBe(5);
  });

  it("stops saving once someone else has changed the edition, and keeps what was typed on screen", async () => {
    api.saveAdminDigest.mockRejectedValue(new api.AdminApiError("This content changed while you were editing it. Refresh and try again.", "conflict"));
    const session = new DigestSession(digest(3), words);
    session.change({ title: "Mine" });
    await vi.advanceTimersByTimeAsync(700);
    expect(session.read()).toMatchObject({ stale: true, words: { title: "Mine" } });
    session.change({ title: "Mine, still" });
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).toHaveBeenCalledTimes(1);
    expect(await session.move("submit")).toBe(false);
    expect(api.moveAdminDigest).not.toHaveBeenCalled();
  });

  it("says why text was refused and saves again once it is changed", async () => {
    const refused = new api.AdminApiError("A digest cannot hold images.", "validation_failed");
    api.saveAdminDigest.mockRejectedValueOnce(refused).mockRejectedValueOnce(refused).mockResolvedValueOnce(digest(4));
    const session = new DigestSession(digest(3), words);
    session.change({ markdown: "![chart](/chart.png)" });
    await vi.advanceTimersByTimeAsync(700);
    expect(session.read()).toMatchObject({ problem: "A digest cannot hold images.", stale: false });
    // A step does not go ahead over text the library refused.
    expect(await session.move("publish")).toBe(false);
    expect(api.moveAdminDigest).not.toHaveBeenCalled();
    session.change({ markdown: "A chart follows." });
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).toHaveBeenLastCalledWith("edition", 3, { ...words, markdown: "A chart follows." });
    expect(session.read()).toMatchObject({ problem: null, digest: { revision: 4 } });
  });

  it("saves what is on screen before a step, takes the step from the saved revision, and shows the text the library answers with", async () => {
    api.saveAdminDigest.mockResolvedValue(digest(4));
    const published = digest(5, { ...words, title: "Typed just now" });
    api.moveAdminDigest.mockResolvedValue({ ...published, state: "published" });
    const session = new DigestSession(digest(3), words);
    session.change({ title: "Typed just now" });
    const moving = session.move("publish");
    expect(session.read().busy).toBe("publish");
    expect(await moving).toBe(true);
    expect(api.saveAdminDigest).toHaveBeenCalledWith("edition", 3, { ...words, title: "Typed just now" });
    expect(api.moveAdminDigest).toHaveBeenCalledWith("edition", 4, "publish");
    expect(session.read()).toMatchObject({ busy: null, digest: { revision: 5, state: "published" }, words: { title: "Typed just now" } });
    // The save the step made is not made a second time by the timer.
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).toHaveBeenCalledTimes(1);
  });
});
