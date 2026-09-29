import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A worker that reads every PDF at once, and that a test can break.
const workers = vi.hoisted(() => ({ list: [] as EventEmitter[], failToStart: 0 }));
vi.mock("node:worker_threads", async () => {
	const { EventEmitter } = await import("node:events");
	class FakeWorker extends EventEmitter {
		constructor() {
			super();
			if (workers.failToStart > 0) {
				workers.failToStart--;
				throw new Error("Worker could not start");
			}
			workers.list.push(this);
		}
		postMessage() {
			setImmediate(() => this.emit("message", { result: { cover: new Uint8Array(1), coverHeight: 1, coverWidth: 1600, pageCount: 1, text: "read" } }));
		}
		ref() {}
		unref() {}
		terminate() {
			return Promise.resolve(0);
		}
	}
	return { Worker: FakeWorker };
});

const pdf = () => new TextEncoder().encode("%PDF-1.7");
let processPdfInWorkers: typeof import("@/lib/admin/pdf-pool").processPdfInWorkers;

beforeEach(async () => {
	vi.resetModules();
	workers.list.length = 0;
	workers.failToStart = 0;
	({ processPdfInWorkers } = await import("@/lib/admin/pdf-pool"));
});

describe("processPdfInWorkers when a worker fails", () => {
	it("keeps reading after an idle worker errors or exits", async () => {
		await expect(processPdfInWorkers(pdf())).resolves.toMatchObject({ text: "read" });
		const [first] = workers.list;
		// Without a listener, an EventEmitter error would throw here.
		first!.emit("error", new Error("worker broke while idle"));
		await expect(processPdfInWorkers(pdf())).resolves.toMatchObject({ text: "read" });
		workers.list.at(-1)!.emit("exit", 0);
		// The next PDF goes to a new worker, not the one that exited.
		const started = Date.now();
		await expect(processPdfInWorkers(pdf())).resolves.toMatchObject({ text: "read" });
		expect(Date.now() - started).toBeLessThan(1_000);
		expect(workers.list.length).toBe(3);
	});

	it("fails waiting PDFs when no worker can start, and tries again for the next PDF", async () => {
		workers.failToStart = 1;
		await expect(processPdfInWorkers(pdf())).rejects.toThrow("could not be processed");
		await expect(processPdfInWorkers(pdf())).resolves.toMatchObject({ text: "read" });
	});
});
