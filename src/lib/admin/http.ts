import { ZodError } from "zod";
import { NextResponse } from "next/server";

import { databaseErrorCode, isTransientConflict } from "@/db/transient-conflict";

import {
	ItemDraftConflictError,
	ItemHasActivePublicationError,
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
	ZenodoPdfCorrectionConfirmationRequiredError,
} from "./native-file-service";
import { EvidenceFileStorageError } from "./file-storage";
import { InvalidPdfError } from "./pdf-processing";
import {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_PUBLISH_PERMISSION,
	authorizeAdminRequest,
	type AdminPermission,
  type AdminSession,
} from "./access";
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
import {
	AdminSourceWritebackConflictError,
	AdminSourceWritebackRetryError,
	ItemWritebackSourcesChildError,
} from "./source-writeback-service";
import { SourceWritebackUnknownSourceError } from "@/lib/source-writeback/queue";
import { CollectionWritebackUnavailableError } from "./collection-mutation-service";
import {
	CrossrefActivationConfigurationError,
	CrossrefActivationValidationError,
	CrossrefDoiAlreadyManagedError,
	ExternalCrossrefDoiError,
	PublicationItemNotFoundError,
	ZenodoActivationConfigurationError,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
} from "@/lib/publication/errors";
import { ZenodoReconnectError } from "@/lib/publication/zenodo-token";

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

export async function readOptionalAdminJson(request: Request) {
	const text = await request.text();
	if (!text.trim()) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new AdminValidationError(
			"The submitted information could not be read.",
			{
				_form: "Reload the page and try again. If the problem continues, contact support.",
			},
			{ cause: error },
		);
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
				...(details.conflictingDraft ? { conflictingDraft: details.conflictingDraft } : {}),
				...(details.fields && Object.keys(details.fields).length > 0
					? { fields: details.fields }
					: {}),
				message: details.message,
			},
		},
		{ status: details.status, headers: ADMIN_RESPONSE_HEADERS },
	);
}

type AdminRequest = { headers: Headers };

async function readAdminPermission(
	request: AdminRequest,
	permission: AdminPermission,
) {
	const authorization = await authorizeAdminRequest(request.headers, permission);
	if (authorization.status === "authorized") return { session: authorization.session, denied: null };
  if (authorization.status === "unavailable") return { session: null, denied: NextResponse.json({ error: { code: "access_unavailable", message: "Unable to verify community access. Try again shortly." } }, { status: 503, headers: ADMIN_RESPONSE_HEADERS }) };
	if (authorization.status === "forbidden") {
		return { session: null, denied: adminForbiddenResponse(permission) };
	}
	if (authorization.status === "no_access") {
		return { session: null, denied: adminError({
			code: "forbidden",
			message: "You do not have access to this community's admin area.",
			status: 403,
		}) };
	}
	return { session: null, denied: adminError({
		code: "unauthorized",
		message: "Sign in to continue.",
		status: 401,
	}) };
}

export function adminForbiddenResponse(permission: AdminPermission) {
  return adminError({code: "forbidden", status: 403,
    message: permission === ADMIN_PUBLISH_PERMISSION ? "An Editor or Owner must publish this change." : "Only a community Owner can do this."});
}

export async function handleAdminResponse(
  request: AdminRequest,
  permission: AdminPermission,
  action: (session: AdminSession) => Promise<Response>,
) {
  const access = await readAdminPermission(request, permission);
  if (access.denied) return access.denied;
  try { return await action(access.session); }
  catch (error) { return adminErrorResponse(error); }
}

export function handleAdminJson(
  request: AdminRequest,
  permission: AdminPermission,
  action: (session: AdminSession) => Promise<Record<string, unknown>>,
) {
  return handleAdminResponse(request, permission, async session =>
    NextResponse.json(await action(session), {headers: ADMIN_RESPONSE_HEADERS}));
}

export async function requireAdminPermission(request: AdminRequest, permission: AdminPermission) {
	return (await readAdminPermission(request, permission)).denied;
}

/** Shared content-permission guard for every current admin data route. */
export function requireAdminSession(request: AdminRequest) {
	return requireAdminPermission(request, ADMIN_CONTENT_PERMISSION);
}

export function requireAdminPublisher(request: AdminRequest) {
  return requireAdminPermission(request, ADMIN_PUBLISH_PERMISSION);
}

export function adminErrorDetails(error: unknown): AdminErrorDetails {
	if (
		error instanceof ItemNotFoundError ||
		error instanceof NativeFileNotFoundError ||
		error instanceof CollectionNotFoundError ||
		error instanceof PublicationItemNotFoundError
	) {
		return {
			code: "not_found",
			message: "The requested record is no longer available.",
			status: 404,
		};
	}
	if (
		error instanceof ExternalCrossrefDoiError ||
		error instanceof CrossrefDoiAlreadyManagedError ||
		error instanceof ZenodoIdentifierPolicyLockedError
	) {
		return {
			code: "conflict",
			message: error.message,
			status: 409,
		};
	}
	if (error instanceof ZenodoPdfCorrectionConfirmationRequiredError) {
		return {
			code: "confirmation_required",
			message: error.message,
			status: 409,
		};
	}
	if (
		error instanceof CrossrefActivationConfigurationError ||
		error instanceof ZenodoActivationConfigurationError ||
		error instanceof ZenodoReconnectError
	) {
		return {
			code: "conflict",
			message: error.message,
			status: 409,
		};
	}
	if (
		error instanceof CrossrefActivationValidationError ||
		error instanceof ZenodoActivationValidationError
	) {
		const details = validationErrorPayload(error.message, {
			...error.fields,
		});
		return { ...details, status: 400 };
	}
	if (error instanceof ItemDraftConflictError && error.fields.length > 0) {
		return {
			conflictingDraft: error.conflictingDraft,
			code: "conflict",
			fields: Object.fromEntries(
				error.fields.map((field) => [
					field,
					"Changed in another session.",
				]),
			),
			message:
				"Another session changed these fields. Choose which values to keep.",
			status: 409,
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
				"Use Remove PDF from draft, then submit and publish the parent record's updated version. You can then unpublish this attachment.",
			status: 409,
		};
	}
	if (error instanceof ItemHasActivePublicationError) {
		return {
			code: "conflict",
			message:
				"This record has a DOI, so it can't be deleted. Withdraw it from its editor, with a reason readers will see.",
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
	if (error instanceof AdminSourceWritebackConflictError) {
		return { code: "conflict", message: error.message, status: 409 };
	}
	if (error instanceof ItemWritebackSourcesChildError) {
		return {
			code: "conflict",
			message:
				"Attachments and notes follow their parent record. Change the sources on the parent.",
			status: 409,
		};
	}
	if (error instanceof SourceWritebackUnknownSourceError) {
		const details = validationErrorPayload(
			"Choose only sources that can receive updates for this record.",
			{ sourceKeys: error.message },
		);
		return { ...details, status: 400 };
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
	const databaseCode = databaseErrorCode(error);
	if (isTransientConflict(error)) {
		return {
			code: "conflict",
			message:
				"This content changed while you were editing it. Refresh and try again.",
			status: 409,
		};
	}
	if (databaseCode === "23503" || databaseCode === "23514") {
		return {
			code: "invalid_reference",
			message:
				"Some selected records are no longer available. Refresh and try again.",
			status: 400,
		};
	}
	if (databaseCode === "23505") {
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
