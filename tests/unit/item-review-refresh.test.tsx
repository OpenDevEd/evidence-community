// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useItemReview } from "@/components/admin/useItemReview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function Review() {
 const review = useItemReview("ABCD2345");
 return <><button onClick={() => void review.refresh()}>Refresh</button><output>{review.snapshot?.title ?? "Loading"}:{review.pending ? "pending" : "not pending"}</output></>;
}
beforeEach(() => {
 container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("keeps the previous snapshot and state together until a refreshed version loads", async () => {
 let revision = 1;
 let finishSnapshot: (response: Response) => void = () => { throw new Error("No pending snapshot request"); };
 let requestedNewSnapshot = false;
 const nextSnapshot = new Promise<Response>(resolve => { finishSnapshot = resolve; });
 vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  if (url.endsWith("/review")) return Response.json({ reviews: [{ id: "review-1", revision, state: revision === 1 ? "pending" : "returned" }] });
  if (revision === 1) return Response.json({ snapshot: { reviewId: "review-1", reviewRevision: 1, reviewState: "pending", title: "Submitted title" } });
  requestedNewSnapshot = true;
  return nextSnapshot;
 }));
 await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Review /></SWRConfig>));
 await act(async () => { await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("Submitted title:pending")); });
 revision = 2;
 await act(async () => { container.querySelector("button")!.click(); await vi.waitFor(() => expect(requestedNewSnapshot).toBe(true)); });
 expect(container.querySelector("output")?.textContent).toBe("Submitted title:pending");
 await act(async () => {
  finishSnapshot(Response.json({ snapshot: { reviewId: "review-1", reviewRevision: 2, reviewState: "returned", title: "Corrected title" } }));
 });
 await act(async () => { await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("Corrected title:not pending")); });
});
