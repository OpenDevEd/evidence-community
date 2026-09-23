import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isPrivateIp } from "@/lib/public-fetch";

describe("public addresses", () => {
	it("refuses private, loopback, link-local, shared and multicast addresses", () => {
		for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1"]) {
			expect(isPrivateIp(address), address).toBe(true);
		}
	});

	it("reads an IPv4 address written as IPv6 as that IPv4 address", () => {
		expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
		expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
		expect(isPrivateIp("::ffff:93.184.216.34")).toBe(false);
	});

	it("lets public addresses through", () => {
		expect(isPrivateIp("93.184.216.34")).toBe(false);
		expect(isPrivateIp("2606:4700::6810:84e5")).toBe(false);
	});
});
