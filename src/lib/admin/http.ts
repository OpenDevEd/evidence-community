import { ZodError } from "zod";
import { DrizzleQueryError } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
	NativeDraftConflictError,
	NativeItemHasPublishedFileError,
	NativeItemNotFoundError,
} from "./native-item-service";
import {
	NativeFileConflictError,
	NativeFileNotFoundError,
	NativeFileValidationError,
} from "./native-file-service";
import { EvidenceFileStorageError } from "./file-storage";
import { InvalidPdfError } from "./pdf-processing";
import { isAdminBypassEnabled } from "./access";
import { NativeItemValidationError } from "./native-item-validation";

export const ADMIN_RESPONSE_HEADERS = {
	"Cache-Control": "private, no-store",
};

export function requireAdminBypass() {
	if (isAdminBypassEnabled()) return null;
	return NextResponse.json(
		{ error: "Not found" },
		{ status: 404, headers: ADMIN_RESPONSE_HEADERS },
	);
}

export function adminErrorResponse(error: unknown) {
	if (
		error instanceof NativeItemNotFoundError ||
		error instanceof NativeFileNotFoundError
	) {
		return NextResponse.json(
			{ error: error.message },
			{ status: 404, headers: ADMIN_RESPONSE_HEADERS },
		);
	}
	if (
		error instanceof NativeDraftConflictError ||
		error instanceof NativeItemHasPublishedFileError ||
		error instanceof NativeFileConflictError
	) {
		return NextResponse.json(
			{ error: error.message },
			{ status: 409, headers: ADMIN_RESPONSE_HEADERS },
		);
	}
	if (
		error instanceof ZodError ||
		error instanceof SyntaxError ||
		error instanceof NativeItemValidationError ||
		error instanceof NativeFileValidationError ||
		error instanceof InvalidPdfError
	) {
		return NextResponse.json(
			{ error: error.message },
			{ status: 400, headers: ADMIN_RESPONSE_HEADERS },
		);
	}
	const databaseError = (
		error instanceof DrizzleQueryError ? error.cause : error
	) as { code?: string } | undefined;
	if (
		databaseError?.code === "23503" ||
		databaseError?.code === "23514"
	) {
		return NextResponse.json(
			{ error: "Draft references missing or invalid records" },
			{ status: 400, headers: ADMIN_RESPONSE_HEADERS },
		);
	}
	if (databaseError?.code === "23505") {
		return NextResponse.json(
			{ error: "Record already exists" },
			{ status: 409, headers: ADMIN_RESPONSE_HEADERS },
		);
	}
	if (error instanceof EvidenceFileStorageError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: 502, headers: ADMIN_RESPONSE_HEADERS },
		);
	}

	console.error("Admin item operation failed", error);
	return NextResponse.json(
		{ error: "Admin item operation failed" },
		{ status: 500, headers: ADMIN_RESPONSE_HEADERS },
	);
}
