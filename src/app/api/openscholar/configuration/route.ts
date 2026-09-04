import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
	activateLibraryConfig,
	restorePreviousLibraryConfig,
} from "@/config/library-config/activation";
import { MAX_LIBRARY_CONFIG_BYTES } from "@/config/library-config/schema";
import {
	LibraryConfigSourceError,
	resolveLibraryConfigPath,
} from "@/config/library-config/source";
import { ADMIN_RESPONSE_HEADERS } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";

async function readBoundedBody(request: Request) {
	const declared = Number(request.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_LIBRARY_CONFIG_BYTES) {
		throw new LibraryConfigSourceError("Configuration is too large", {
			code: "FILE_TOO_LARGE",
		});
	}
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_LIBRARY_CONFIG_BYTES) {
			await reader.cancel();
			throw new LibraryConfigSourceError("Configuration is too large", {
				code: "FILE_TOO_LARGE",
			});
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function jsonError(code: string, message: string, status: number) {
	return NextResponse.json(
		{ error: { code, message } },
		{ headers: ADMIN_RESPONSE_HEADERS, status },
	);
}

function isConfigurationConflict(error: unknown): error is Error {
	return (
		error instanceof Error &&
		(error.message.includes("Another library configuration operation") ||
			error.message.includes("preserved configuration"))
	);
}

function errorResponse(
	error: unknown,
	operation: "activate" | "restore",
) {
	if (isConfigurationConflict(error)) {
		return jsonError("conflict", error.message, 409);
	}
	if (error instanceof LibraryConfigSourceError) {
		return jsonError(
			"invalid_configuration",
			"The submitted library configuration is invalid.",
			error.code === "FILE_TOO_LARGE" ? 413 : 400,
		);
	}
	console.error(`OpenScholar configuration ${operation} failed.`, error);
	return jsonError(
		"internal_error",
		"The library configuration could not be changed.",
		500,
	);
}

export async function PUT(request: NextRequest) {
	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;
	const targetPath = resolveLibraryConfigPath({ environment: "production" });
	const candidatePath = path.join(
		path.dirname(targetPath),
		`.${path.basename(targetPath)}.${randomUUID()}.tmp`,
	);
	try {
		const body = await readBoundedBody(request);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(candidatePath, body, { flag: "wx", mode: 0o600 });
		const result = await activateLibraryConfig({
			candidatePath,
			targetPath,
		});
		return NextResponse.json(
			{
				revision: result.active.revision,
				sourceSha256: createHash("sha256").update(body).digest("hex"),
				status: "active",
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return errorResponse(error, "activate");
	} finally {
		await unlink(candidatePath).catch(() => undefined);
	}
}

export async function DELETE(request: NextRequest) {
	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;
	try {
		const body = (await request.json()) as { revision?: unknown };
		if (typeof body.revision !== "string" || !body.revision.trim()) {
			return jsonError(
				"invalid_request",
				"Previous revision is required.",
				400,
			);
		}
		const result = await restorePreviousLibraryConfig({
			revision: body.revision,
			targetPath: resolveLibraryConfigPath({ environment: "production" }),
		});
		return NextResponse.json(
			{ revision: result.active.revision, status: "active" },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return errorResponse(error, "restore");
	}
}
