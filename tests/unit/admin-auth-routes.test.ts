import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: () => ({
		authentication: {
			adminPassword: "correct horse battery staple",
			secret: "12345678901234567890123456789012",
		},
	}),
}));

import { POST as login } from "@/app/api/admin/session/route";
import { POST as logout } from "@/app/api/admin/session/logout/route";

function loginRequest(password: string, address: string) {
	const body = new FormData();
	body.set("password", password);
	return new NextRequest("http://localhost/api/admin/session", {
		body,
		headers: {
			origin: "http://localhost",
			"x-real-ip": address,
		},
		method: "POST",
	});
}

describe("admin session routes", () => {
	it("keeps every admin data handler behind the shared session gate", async () => {
		const root = join(process.cwd(), "src/app/api/admin");
		const routeFiles: string[] = [];
		async function visit(directory: string) {
			for (const entry of await readdir(directory, {
				withFileTypes: true,
			})) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) await visit(path);
				else if (entry.name === "route.ts") routeFiles.push(path);
			}
		}
		await visit(root);

		for (const path of routeFiles.filter(
			(path) => !path.includes("/api/admin/session/"),
		)) {
			const source = await readFile(path, "utf8");
			const handlers =
				source.match(/export async function /gu)?.length ?? 0;
			const gates =
				source.match(/await requireAdminSession\(request\)/gu)
					?.length ?? 0;
			expect(gates, path).toBe(handlers);
		}
	});

	it("sets the signed cookie after the correct password", async () => {
		const response = await login(
			loginRequest("correct horse battery staple", "198.51.100.10"),
		);
		const cookie = response.headers.get("set-cookie") ?? "";

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("http://localhost/admin");
		expect(cookie).toContain("evidence_library_admin=");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=strict");
		expect(cookie).toContain("Path=/");
		expect(cookie).not.toContain("Domain=");
		expect(cookie).not.toContain("Secure");
	});

	it("rejects a wrong password without creating a cookie", async () => {
		const response = await login(
			loginRequest("wrong password", "198.51.100.11"),
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"http://localhost/admin?login=invalid",
		);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("does not count successful logins as failures", async () => {
		for (let attempt = 0; attempt < 7; attempt += 1) {
			const response = await login(
				loginRequest("correct horse battery staple", "198.51.100.20"),
			);
			expect(response.headers.get("location")).toBe(
				"http://localhost/admin",
			);
		}
	});

	it("limits repeated wrong passwords", async () => {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			await login(loginRequest("wrong password", "198.51.100.21"));
		}
		const response = await login(
			loginRequest("wrong password", "198.51.100.21"),
		);
		expect(response.headers.get("location")).toBe(
			"http://localhost/admin?login=limited",
		);
	});

	it("rejects a cross-site login", async () => {
		const request = loginRequest(
			"correct horse battery staple",
			"198.51.100.12",
		);
		request.headers.set("origin", "https://attacker.example");

		expect((await login(request)).status).toBe(403);
	});

	it("clears the cookie on logout", async () => {
		const response = await logout(
			new NextRequest("http://localhost/api/admin/session/logout", {
				headers: { origin: "http://localhost" },
				method: "POST",
			}),
		);
		const cookie = response.headers.get("set-cookie") ?? "";

		expect(response.status).toBe(303);
		expect(cookie).toContain("evidence_library_admin=");
		expect(cookie).toContain("Max-Age=0");
	});
});
