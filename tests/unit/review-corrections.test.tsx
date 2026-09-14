// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useReviewCorrections } from "@/components/admin/useReviewCorrections";

vi.mock("sonner", () => ({toast: {error: vi.fn()}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function Editor() {
 const [revision, setRevision] = useState(1);
 const corrections = useReviewCorrections({key: "ABCD2345", reviewId: "review-1", reviewRevision: revision, draft: {baseRevision: 0, payload: {title: "Submitted"}}, frozenAttachments: []}, async () => {setRevision(current => current + 1);});
 return <><button onClick={() => corrections.change("ABCD2345", {title: "First correction"})}>First</button><button onClick={() => corrections.change("ABCD2345", previous => ({...previous, abstractNote: "Later correction"}))}>Later</button><output>{corrections.saving ? "saving" : "saved"}:{String(corrections.payloads.ABCD2345?.abstractNote ?? corrections.payloads.ABCD2345?.title ?? "")}:{corrections.error ?? ""}</output></>;
}
beforeEach(() => {vi.useFakeTimers();container = document.createElement("div");document.body.append(container);root = createRoot(container);});
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function click(index: number) {await act(async () => {container.querySelectorAll("button")[index]!.click();await vi.advanceTimersByTimeAsync(700);});}

it("serializes corrections made during an in-flight save against the acknowledged revision", async () => {
 const requests: unknown[] = [];
 let finish: (response: Response) => void = () => {throw new Error("No save in flight");};
 const first = new Promise<Response>(resolve => {finish = resolve;});
 vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
  requests.push(JSON.parse(String(options.body)));
  return requests.length === 1 ? first : Response.json({review:{revision:3}});
 }));
 await act(async () => root.render(<Editor />));
 await click(0);
 await click(1);
 expect(requests).toEqual([{action:"correct",expectedRevision:1,records:[{itemKey:"ABCD2345",baseRevision:0,payload:{title:"First correction"}}]}]);
 expect(container.querySelector("output")?.textContent).toContain("saving:Later correction");
 await act(async () => {finish(Response.json({review:{revision:2}}));});
 expect(requests).toEqual([
  {action:"correct",expectedRevision:1,records:[{itemKey:"ABCD2345",baseRevision:0,payload:{title:"First correction"}}]},
  {action:"correct",expectedRevision:2,records:[{itemKey:"ABCD2345",baseRevision:0,payload:{title:"First correction",abstractNote:"Later correction"}}]},
 ]);
 expect(container.querySelector("output")?.textContent).toBe("saved::");
});

it("keeps unsaved corrections after a failed request and retries with the newest edit", async () => {
 const requests: unknown[] = [];
 vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
  requests.push(JSON.parse(String(options.body)));
  return requests.length === 1 ? Response.json({error:{code:"unavailable",message:"Save unavailable"}},{status:503}) : Response.json({review:{revision:2}});
 }));
 await act(async () => root.render(<Editor />));
 await click(0);
 expect(container.querySelector("output")?.textContent).toContain("saving:First correction:");
 await click(1);
 expect(requests).toEqual([
  {action:"correct",expectedRevision:1,records:[{itemKey:"ABCD2345",baseRevision:0,payload:{title:"First correction"}}]},
  {action:"correct",expectedRevision:1,records:[{itemKey:"ABCD2345",baseRevision:0,payload:{title:"First correction",abstractNote:"Later correction"}}]},
 ]);
 expect(container.querySelector("output")?.textContent).toBe("saved::");
});
