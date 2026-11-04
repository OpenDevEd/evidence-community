import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	cloneLibraryConfig,
	minimalLibraryConfig,
} from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: async () => ({
		authentication: {
			openScholar: { machineCredential: `els_${"a".repeat(43)}` },
		},
	}),
}));

import { DELETE, PUT } from "@/app/api/openscholar/configuration/route";

const machineCredential = `els_${"a".repeat(43)}`;
let tempDirectory: string;
let targetPath: string;

function request(method: "DELETE" | "PUT", body: unknown, authorized = true) {
	return new NextRequest(
		"https://library.example.org/api/openscholar/configuration",
		{
			body: JSON.stringify(body),
			headers: authorized
				? { authorization: `Bearer ${machineCredential}` }
				: undefined,
			method,
		},
	);
}

beforeEach(async () => {
	tempDirectory = await mkdtemp(
		path.join(os.tmpdir(), "openscholar-config-route-"),
	);
	targetPath = path.join(tempDirectory, "library.json");
	process.env.LIBRARY_CONFIG_PATH = targetPath;
	await writeFile(
		targetPath,
		JSON.stringify(minimalLibraryConfig, null, "\t"),
		"utf8",
	);
});

afterEach(async () => {
	delete process.env.LIBRARY_CONFIG_PATH;
	await rm(tempDirectory, { force: true, recursive: true });
});

describe("OpenScholar configuration route", () => {
	it("activates a complete configuration and returns its exact source digest", async () => {
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:05:00Z";
		candidate.identity.name = "Activated through OpenScholar";
		const serialized = JSON.stringify(candidate);

		const response = await PUT(
			new NextRequest(
				"https://library.example.org/api/openscholar/configuration",
				{
					body: serialized,
					headers: { authorization: `Bearer ${machineCredential}` },
					method: "PUT",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			revision: "minimal-2",
			sourceSha256: createHash("sha256").update(serialized).digest("hex"),
			status: "active",
		});
		expect(
			(await readdir(tempDirectory)).filter((entry) =>
				entry.endsWith(".tmp"),
			),
		).toEqual([]);
	});

	it("restores the requested previous revision", async () => {
		const candidate = cloneLibraryConfig(minimalLibraryConfig);
		candidate.revision = "minimal-2";
		candidate.updatedAt = "2026-07-28T16:05:00Z";
		await PUT(request("PUT", candidate));

		const response = await DELETE(
			request("DELETE", { revision: minimalLibraryConfig.revision }),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			revision: minimalLibraryConfig.revision,
			status: "active",
		});
	});

	it("rejects an unauthenticated write before changing the file", async () => {
		const response = await PUT(request("PUT", minimalLibraryConfig, false));

		expect(response.status).toBe(401);
	});

	it("rejects an oversized configuration before writing it", async () => {
		const response = await PUT(
			new NextRequest(
				"https://library.example.org/api/openscholar/configuration",
				{
					body: "x".repeat(1024 * 1024 + 1),
					headers: { authorization: `Bearer ${machineCredential}` },
					method: "PUT",
				},
			),
		);

		expect(response.status).toBe(413);
	});

	it("records unexpected activation failures before returning a masked error", async () => {
		const blockedDirectory = path.join(tempDirectory, "blocked");
		await writeFile(blockedDirectory, "not a directory", "utf8");
		process.env.LIBRARY_CONFIG_PATH = path.join(
			blockedDirectory,
			"library.json",
		);
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const response = await PUT(request("PUT", minimalLibraryConfig));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: {
				code: "internal_error",
				message: "The community configuration could not be changed.",
			},
		});
		expect(log).toHaveBeenCalledWith(
			"OpenScholar configuration activate failed.",
			expect.any(Error),
		);
	});
});
