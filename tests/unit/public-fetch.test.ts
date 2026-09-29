import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// A name that resolves to a private address when connected to: the connection must be refused.
vi.mock("node:dns", () => ({
	lookup: (_hostname: string, _options: unknown, callback: (error: null, addresses: { address: string; family: number }[]) => void) =>
		callback(null, [{ address: "169.254.169.254", family: 4 }]),
}));

import { isPrivateIp, publicRequest } from "@/lib/public-fetch";

describe("public addresses", () => {
	it("refuses private, loopback, link-local, shared and multicast addresses", () => {
		for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "192.0.2.1", "240.0.0.1", "::1", "::", "fd00::1", "fe80::1", "fec0::5", "2001:db8::1", "ff02::1"]) {
			expect(isPrivateIp(address), address).toBe(true);
		}
	});

	it("reads an IPv4 address written as IPv6 as that IPv4 address", () => {
		expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
		expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
		expect(isPrivateIp("0:0:0:0:0:ffff:a9fe:a9fe")).toBe(true);
		expect(isPrivateIp("::ffff:5db8:d822")).toBe(false);
		expect(isPrivateIp("64:ff9b::a9fe:a9fe")).toBe(true);
		expect(isPrivateIp("64:ff9b::10.0.0.1")).toBe(true);
		expect(isPrivateIp("64:ff9b::5db8:d822")).toBe(false);
		expect(isPrivateIp("::ffff:93.184.216.34")).toBe(false);
	});

	it("lets public addresses through", () => {
		expect(isPrivateIp("93.184.216.34")).toBe(false);
		expect(isPrivateIp("2606:4700::6810:84e5")).toBe(false);
	});

	it("refuses an address written into the URL without looking anything up", async () => {
		for (const url of ["http://169.254.169.254/latest/meta-data", "http://[::1]/", "https://10.0.0.5/paper.pdf", "http://[::ffff:127.0.0.1]/"]) {
			await expect(publicRequest(new URL(url), {}), url).rejects.toThrow("Private URL is not allowed");
		}
	});

	it("refuses a name whose lookup gives a private address when it connects", async () => {
		await expect(publicRequest(new URL("https://rebinding.example/logo.png"), {})).rejects.toThrow();
		await expect(publicRequest(new URL("https://rebinding.example/logo.png"), {}).catch((error: Error) => String(error.cause ?? error))).resolves.toMatch(/Private URL is not allowed/u);
	});
});
