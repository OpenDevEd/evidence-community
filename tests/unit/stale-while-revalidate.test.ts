import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { forgetStaleValues, staleWhileRevalidate } = await import("@/lib/stale-while-revalidate");

afterEach(() => {
	forgetStaleValues();
	vi.useRealTimers();
});

it("waits only for the first value, then answers with the last one while one refresh runs behind it", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	let release!: (value: number) => void;
	const compute = vi.fn().mockResolvedValueOnce(1).mockImplementationOnce(() => new Promise<number>((resolve) => (release = resolve)));
	expect(await staleWhileRevalidate("counts", 60_000, compute)).toBe(1);
	expect(await staleWhileRevalidate("counts", 60_000, compute)).toBe(1);
	expect(compute).toHaveBeenCalledTimes(1);

	vi.setSystemTime(Date.now() + 61_000);
	expect(await staleWhileRevalidate("counts", 60_000, compute)).toBe(1);
	expect(await staleWhileRevalidate("counts", 60_000, compute)).toBe(1);
	expect(compute).toHaveBeenCalledTimes(2);
	release(2);
	await vi.waitFor(async () => expect(await staleWhileRevalidate("counts", 60_000, compute)).toBe(2));
});

it("shares the first compute between concurrent callers and keeps the last value when a refresh fails", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const compute = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("pool timeout")).mockResolvedValue("third");
	expect(await Promise.all([staleWhileRevalidate("home", 60_000, compute), staleWhileRevalidate("home", 60_000, compute)])).toEqual(["first", "first"]);
	vi.setSystemTime(Date.now() + 61_000);
	expect(await staleWhileRevalidate("home", 60_000, compute)).toBe("first");
	await vi.waitFor(() => expect(error).toHaveBeenCalled());
	expect(await staleWhileRevalidate("home", 60_000, compute)).toBe("first");
	await vi.waitFor(async () => expect(await staleWhileRevalidate("home", 60_000, compute)).toBe("third"));
	error.mockRestore();
});

it("computes afresh after the values are forgotten", async () => {
	const compute = vi.fn().mockResolvedValueOnce("before").mockResolvedValueOnce("after");
	expect(await staleWhileRevalidate("status", 60_000, compute)).toBe("before");
	forgetStaleValues();
	expect(await staleWhileRevalidate("status", 60_000, compute)).toBe("after");
});

it("drops a value counted before the cache was cleared", async () => {
	let release!: (value: string) => void;
	const slow = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
	const pending = staleWhileRevalidate("cleared", 60_000, slow);
	forgetStaleValues();
	expect(await staleWhileRevalidate("cleared", 60_000, async () => "fresh")).toBe("fresh");
	release("old");
	expect(await pending).toBe("old");
	expect(await staleWhileRevalidate("cleared", 60_000, async () => "unused")).toBe("fresh");
});

it("keeps at most fifty keys, dropping the oldest", async () => {
	for (let index = 0; index < 51; index++) await staleWhileRevalidate(`revision:${index}`, 60_000, async () => index);
	const compute = vi.fn(async () => -1);
	expect(await staleWhileRevalidate("revision:0", 60_000, compute)).toBe(-1);
	expect(await staleWhileRevalidate("revision:50", 60_000, compute)).toBe(50);
	expect(compute).toHaveBeenCalledTimes(1);
});

it("hands a refresh the last value, so one that only partly worked can keep it", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	const compute = vi.fn(async (previous: string | undefined) => (previous ? `${previous}+` : "first"));
	expect(await staleWhileRevalidate("partial", 60_000, compute)).toBe("first");
	vi.setSystemTime(Date.now() + 61_000);
	await staleWhileRevalidate("partial", 60_000, compute);
	await vi.waitFor(async () => expect(await staleWhileRevalidate("partial", 60_000, compute)).toBe("first+"));
	expect(compute).toHaveBeenLastCalledWith("first");
});
