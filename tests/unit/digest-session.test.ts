import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  class AdminApiError extends Error {
    fields: Record<string, string> = {};
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

  it("keeps what is typed while a step is on its way, and saves it once the step is done", async () => {
    const publishing = held();
    api.moveAdminDigest.mockReturnValue(publishing.answer);
    api.saveAdminDigest.mockResolvedValue(digest(5, { ...words, note: "Typed while publishing" }));
    const session = new DigestSession(digest(3), words);
    const step = session.move("publish");
    await vi.advanceTimersByTimeAsync(0);
    session.change({ note: "Typed while publishing" });
    // The save waits its turn: sent now, it would go out from the revision the step is changing.
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).not.toHaveBeenCalled();
    publishing.finish({ ...digest(4), state: "published" } as AdminDigest);
    expect(await step).toBe(true);
    expect(session.read()).toMatchObject({ digest: { revision: 4, state: "published" }, words: { note: "Typed while publishing" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.saveAdminDigest).toHaveBeenCalledWith("edition", 4, { ...words, note: "Typed while publishing" });
  });

  it("sends what was typed at once when the page is left, and says when text would be lost", async () => {
    api.saveAdminDigest.mockResolvedValue(digest(4, { ...words, title: "Typed a moment ago" }));
    const session = new DigestSession(digest(3), words);
    expect(session.leave()).toBe(true);
    expect(api.saveAdminDigest).not.toHaveBeenCalled();
    session.change({ title: "Typed a moment ago" });
    // No waiting for the pause after typing: the page is going.
    expect(session.leave()).toBe(true);
    expect(api.saveAdminDigest).toHaveBeenCalledWith("edition", 3, { ...words, title: "Typed a moment ago" }, true);
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).toHaveBeenCalledTimes(1);
    expect(session.read().digest.revision).toBe(4);

    // Text the library refused cannot be sent on the way out, so the person is asked first.
    api.saveAdminDigest.mockRejectedValueOnce(new api.AdminApiError("Give the digest a title.", "validation_failed"));
    session.change({ title: "" });
    await vi.advanceTimersByTimeAsync(700);
    expect(session.read().problem).toBe("Give the digest a title.");
    expect(session.leave()).toBe(false);
  });

  it("asks before leaving with text that cannot be sent on the way out, and still saves it if the person stays", async () => {
    const session = new DigestSession(digest(3), words);
    // An emptied title the library has not refused yet: sending it would lose the summary typed with it.
    session.change({ title: "", summary: "A new summary." });
    expect(session.leave()).toBe(false);
    expect(api.saveAdminDigest).not.toHaveBeenCalled();
    // Text too long for a request that outlives its page.
    session.change({ title: "August", markdown: "مرحبا ".repeat(6000) });
    expect(session.leave()).toBe(false);
    expect(api.saveAdminDigest).not.toHaveBeenCalled();
    // The person stays: the pause after typing still ends in a save.
    api.saveAdminDigest.mockResolvedValue(digest(4));
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).toHaveBeenCalledTimes(1);
    expect(api.saveAdminDigest.mock.calls[0]).toHaveLength(3);
  });

  it("saves the newer text after an older save when the person chose to stay", async () => {
    const older = held();
    api.saveAdminDigest.mockReturnValueOnce(older.answer).mockResolvedValue(digest(5, { ...words, title: "Newer" }));
    const session = new DigestSession(digest(3), words);
    session.change({ title: "Older" });
    await vi.advanceTimersByTimeAsync(700);
    session.change({ title: "Newer" });
    // The older save is still on its way, so the newer text cannot go yet: the browser asks, and the person stays.
    expect(session.leave()).toBe(false);
    older.finish(digest(4, { ...words, title: "Older" }));
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveAdminDigest).toHaveBeenLastCalledWith("edition", 4, { ...words, title: "Newer" });
    expect(session.read().digest.revision).toBe(5);
  });

  it("says which field the library refused, in its words", async () => {
    const refused = Object.assign(new api.AdminApiError("Check the highlighted fields and try again.", "validation_failed"), { fields: { note: "Keep the note to 2,000 characters." } });
    api.saveAdminDigest.mockRejectedValueOnce(refused);
    const session = new DigestSession(digest(3), words);
    session.change({ note: "x".repeat(2001) });
    await vi.advanceTimersByTimeAsync(700);
    expect(session.read().problem).toBe("Keep the note to 2,000 characters.");
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
