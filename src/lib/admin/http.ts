import { ZodError } from "zod";
import { DrizzleQueryError } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
	ItemDraftConflictError,
	ItemHasChildrenError,
	ItemHasPublishedFileError,
	ItemMutationConflictError,
	ItemNotFoundError,
	ItemParentUnavailableError,
	ItemWritebackUnavailableError,
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
	CollectionConflictError,
	CollectionNotFoundError,
	CollectionValidationError,
} from "./native-collection-service";
import {
	AdminValidationError,
	fieldErrorsFromZod,
	type AdminErrorCode,
	type AdminErrorPayload,
	validationErrorPayload,
} from "./errors";
import { AdminSourceWritebackRetryError } from "./source-writeback-service";
import { CollectionWritebackUnavailableError } from "./collection-mutation-service";

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

export type AdminErrorDetails = AdminErrorPayload["error"] & {
	status: number;
};

function adminError(details: AdminErrorDetails) {
	return NextResponse.json<AdminErrorPayload>(
		{
			error: {
				code: details.code,
				...(details.fields && Object.keys(details.fields).length > 0
					? { fields: details.fields }
					: {}),
				message: details.message,
			},
		},
		{ status: details.status, headers: ADMIN_RESPONSE_HEADERS },
	);
}

export function requireAdminBypass() {
	if (isAdminBypassEnabled()) return null;
	return adminError({
		code: "not_found",
		message: "This page is not available.",
		status: 404,
	});
}

export function adminErrorDetails(error: unknown): AdminErrorDetails {
	if (
		error instanceof ItemNotFoundError ||
		error instanceof NativeFileNotFoundError ||
		error instanceof CollectionNotFoundError
	) {
		return {
			code: "not_found",
			message: "The requested record is no longer available.",
			status: 404,
		};
	}
	if (
		error instanceof ItemDraftConflictError ||
		error instanceof CollectionConflictError ||
		error instanceof ItemMutationConflictError ||
		error instanceof NativeFileConflictError
	) {
		return {
			code: "conflict",
			message:
				"This content changed while you were editing it. Refresh and try again.",
			status: 409,
		};
	}
	if (
		error instanceof ItemWritebackUnavailableError ||
		error instanceof CollectionWritebackUnavailableError
	) {
		const subject =
			error instanceof CollectionWritebackUnavailableError
				? "collection"
				: "record";
		const messages = {
			"item-locked": `This ${subject} has been locked for source writeback.`,
			"not-linked": `This ${subject} is not linked to a writeback source.`,
			ok: `This ${subject} is not currently available for source writeback.`,
			"source-disabled": `Writeback is disabled for this ${subject}'s source.`,
			"source-paused": `This ${subject}'s source is currently paused.`,
			"source-removed": `This ${subject}'s source has been removed.`,
			"unsupported-provider": `This ${subject}'s source does not support writeback.`,
		} satisfies Record<typeof error.reason, string>;
		return {
			code: "conflict",
			message: messages[error.reason],
			status: 409,
		};
	}
	if (error instanceof AdminSourceWritebackRetryError) {
		return {
			code: "conflict",
			message: error.message,
			status: 409,
		};
	}
	if (error instanceof ItemHasPublishedFileError) {
		return {
			code: "conflict",
			message:
				"Unpublish this attachment's PDF before unpublishing the attachment.",
			status: 409,
		};
	}
	if (error instanceof ItemHasChildrenError) {
		return {
			code: "conflict",
			message:
				"Handle this record's attachments first: delete attachment drafts and unpublish published attachments.",
			status: 409,
		};
	}
	if (error instanceof ItemParentUnavailableError) {
		return {
			code: "conflict",
			message:
				"The parent record is unavailable. Restore or publish it, then try again.",
			status: 409,
		};
	}
	if (error instanceof ZodError) {
		const details = validationErrorPayload(
			"Check the highlighted fields and try again.",
			fieldErrorsFromZod(error),
		);
		return { ...details, status: 400 };
	}
	if (
		error instanceof AdminValidationError ||
		error instanceof NativeFileValidationError ||
		error instanceof CollectionValidationError ||
		error instanceof InvalidPdfError
	) {
		const details = validationErrorPayload(
			error.message,
			error instanceof AdminValidationError ? error.fields : {},
		);
		return { ...details, status: 400 };
	}
	const databaseError = (
		error instanceof DrizzleQueryError ? error.cause : error
	) as { code?: string } | undefined;
	if (databaseError?.code === "40P01" || databaseError?.code === "40001") {
		return {
			code: "conflict",
			message:
				"This content changed while you were editing it. Refresh and try again.",
			status: 409,
		};
	}
	if (databaseError?.code === "23503" || databaseError?.code === "23514") {
		return {
			code: "invalid_reference",
			message:
				"Some selected records are no longer available. Refresh and try again.",
			status: 400,
		};
	}
	if (databaseError?.code === "23505") {
		return {
			code: "already_exists",
			message: "This record already exists.",
			status: 409,
		};
	}
	if (error instanceof EvidenceFileStorageError) {
		return {
			code: "storage_unavailable",
			message:
				"File storage is temporarily unavailable. Try again shortly.",
			status: 502,
		};
	}

	console.error("Admin item operation failed", error);
	return {
		code: "internal_error",
		message: "Something went wrong. Try again.",
		status: 500,
	};
}

export function adminErrorResponse(error: unknown) {
	return adminError(adminErrorDetails(error));
}
