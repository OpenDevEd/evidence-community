import { ZodError } from "zod";
import { DrizzleQueryError } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
	NativeDraftConflictError,
	NativeItemHasChildrenError,
	NativeItemHasPublishedFileError,
	NativeItemMutationConflictError,
	NativeItemNotFoundError,
	NativeItemParentUnavailableError,
} from "./native-item-service";
import {
	NativeFileConflictError,
	NativeFileNotFoundError,
	NativeFileValidationError,
} from "./native-file-service";
import { EvidenceFileStorageError } from "./file-storage";
import { InvalidPdfError } from "./pdf-processing";
import { isAdminBypassEnabled } from "./access";
import {
	NativeCollectionConflictError,
	NativeCollectionNotFoundError,
	NativeCollectionValidationError,
} from "./native-collection-service";
import {
	AdminValidationError,
	fieldErrorsFromZod,
	type AdminErrorCode,
	type AdminErrorPayload,
	validationErrorPayload,
} from "./errors";

export const ADMIN_RESPONSE_HEADERS = {
	"Cache-Control": "private, no-store",
} as const;

export async function readAdminJson(request: Request) {
	try {
		return await request.json();
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new AdminValidationError(
				"The submitted information could not be read.",
				{
					_form: "Reload the page and try again. If the problem continues, contact support.",
				},
			);
		}
		throw error;
	}
}

function adminError(
	status: number,
	code: AdminErrorCode,
	message: string,
	fields?: AdminErrorPayload["error"]["fields"],
) {
	return NextResponse.json<AdminErrorPayload>(
		{
			error: {
				code,
				...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
				message,
			},
		},
		{ status, headers: ADMIN_RESPONSE_HEADERS },
	);
}

export function requireAdminBypass() {
	if (isAdminBypassEnabled()) return null;
	return adminError(404, "not_found", "This page is not available.");
}

export function adminErrorResponse(error: unknown) {
	if (
		error instanceof NativeItemNotFoundError ||
		error instanceof NativeFileNotFoundError ||
		error instanceof NativeCollectionNotFoundError
	) {
		return adminError(
			404,
			"not_found",
			"The requested record is no longer available.",
		);
	}
	if (
		error instanceof NativeDraftConflictError ||
		error instanceof NativeCollectionConflictError ||
		error instanceof NativeItemMutationConflictError ||
		error instanceof NativeFileConflictError
	) {
		return adminError(
			409,
			"conflict",
			"This content changed while you were editing it. Refresh and try again.",
		);
	}
	if (error instanceof NativeItemHasPublishedFileError) {
		return adminError(
			409,
			"conflict",
			"Unpublish this attachment's PDF before unpublishing the attachment.",
		);
	}
	if (error instanceof NativeItemHasChildrenError) {
		return adminError(
			409,
			"conflict",
			"Handle this record's attachments first: delete attachment drafts and unpublish published attachments.",
		);
	}
	if (error instanceof NativeItemParentUnavailableError) {
		return adminError(
			409,
			"conflict",
			"The parent record is unavailable. Restore or publish it, then try again.",
		);
	}
	if (error instanceof ZodError) {
		const details = validationErrorPayload(
			"Check the highlighted fields and try again.",
			fieldErrorsFromZod(error),
		);
		return adminError(400, details.code, details.message, details.fields);
	}
	if (
		error instanceof AdminValidationError ||
		error instanceof NativeFileValidationError ||
		error instanceof NativeCollectionValidationError ||
		error instanceof InvalidPdfError
	) {
		const details = validationErrorPayload(
			error.message,
			error instanceof AdminValidationError ? error.fields : {},
		);
		return adminError(400, details.code, details.message, details.fields);
	}
	const databaseError = (
		error instanceof DrizzleQueryError ? error.cause : error
	) as { code?: string } | undefined;
	if (databaseError?.code === "40P01" || databaseError?.code === "40001") {
		return adminError(
			409,
			"conflict",
			"This content changed while you were editing it. Refresh and try again.",
		);
	}
	if (databaseError?.code === "23503" || databaseError?.code === "23514") {
		return adminError(
			400,
			"invalid_reference",
			"Some selected records are no longer available. Refresh and try again.",
		);
	}
	if (databaseError?.code === "23505") {
		return adminError(409, "already_exists", "This record already exists.");
	}
	if (error instanceof EvidenceFileStorageError) {
		return adminError(
			502,
			"storage_unavailable",
			"File storage is temporarily unavailable. Try again shortly.",
		);
	}

	console.error("Admin item operation failed", error);
	return adminError(
		500,
		"internal_error",
		"Something went wrong. Try again.",
	);
}
