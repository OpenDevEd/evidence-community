import "server-only";

import { z } from "zod";

import { READER_COLLECTION_ROLES } from "@/db/schema/tables/reader";
import { OpenScholarServiceError, postToOpenScholar, type OpenScholarService } from "@/lib/openscholar-service";

/**
 * Invitations to a reader's collection live in OpenScholar, which emails
 * them in the library's name and checks the address of whoever accepts with
 * Clerk. The library keeps no addresses; it keeps the members once accepted.
 * Every call names the reader it is made for by their Clerk user ID.
 */
const PATH = "/api/v1/evidence-libraries/collection-invitations";
const CONTRACT_VERSION = 1;

const roleSchema = z.enum(READER_COLLECTION_ROLES);

const pendingInvitationSchema = z.object({
	id: z.string().min(1).max(128),
	collectionId: z.uuid(),
	email: z.string().max(254),
	role: roleSchema,
	delivery: z.enum(["queued", "sent", "failed"]),
	sentAt: z.number(),
	expiresAt: z.number(),
});
export type PendingCollectionInvitation = z.infer<typeof pendingInvitationSchema>;

/**
 * An invitation as its page may show it. The link alone may have been passed
 * on, so only an account with the invited address learns what it is to;
 * any other account is told it went to another address.
 */
const invitationViewSchema = z.discriminatedUnion("state", [
	z.object({ state: z.literal("gone") }),
	z.object({ state: z.literal("other") }),
	z.object({ state: z.enum(["pending", "accepted"]), collectionId: z.uuid(), role: roleSchema }),
]);
export type CollectionInvitationView = z.infer<typeof invitationViewSchema>;

const call = (service: OpenScholarService, action: string, body: object) =>
	postToOpenScholar(service, `${PATH}/${action}`, { contractVersion: CONTRACT_VERSION, ...body });

export async function inviteToCollection(
	service: OpenScholarService,
	input: { clerkUserId: string; collection: { id: string; name: string }; email: string; role: (typeof READER_COLLECTION_ROLES)[number] },
) {
	return pendingInvitationSchema.parse(
		(await call(service, "invite", {
			clerkUserId: input.clerkUserId,
			collectionId: input.collection.id,
			collectionName: input.collection.name,
			email: input.email,
			role: input.role,
		})) as unknown,
	);
}

/** The invitations a reader sent that still wait for an answer, to all their collections. */
export async function listSentInvitations(service: OpenScholarService, clerkUserId: string) {
	const answer = z.object({ invitations: z.array(pendingInvitationSchema).max(500) }).parse(await call(service, "list", { clerkUserId }));
	return answer.invitations;
}

/** Changes the role a waiting invitation gives, sends it again, or cancels it. Only the reader who sent it may. */
export async function changeSentInvitation(
	service: OpenScholarService,
	clerkUserId: string,
	invitationId: string,
	change: { role: (typeof READER_COLLECTION_ROLES)[number] } | { resend: true } | { cancel: true },
) {
	await call(service, "change", { clerkUserId, invitationId, ...change });
}

/** Cancels every invitation to a collection that is being deleted. */
export async function cancelCollectionInvitations(service: OpenScholarService, clerkUserId: string, collectionId: string) {
	await call(service, "cancel", { clerkUserId, collectionId });
}

export async function readCollectionInvitation(service: OpenScholarService, invitationId: string, clerkUserId: string) {
	return invitationViewSchema.parse(await call(service, "read", { clerkUserId, invitationId }));
}

/**
 * Accepts an invitation for the reader, once OpenScholar has checked that
 * their account has the invited address. Accepting again answers the same.
 */
export async function acceptCollectionInvitation(service: OpenScholarService, clerkUserId: string, invitationId: string) {
	return z
		.object({ collectionId: z.uuid(), role: roleSchema })
		.parse(await call(service, "respond", { clerkUserId, invitationId, accept: true }));
}

/** OpenScholar's refusals the reader can act on, by the code it answers with. */
export function invitationRefusal(error: unknown) {
	if (!(error instanceof OpenScholarServiceError) || error.status === null || error.status >= 500) return null;
	return error.code ?? "refused";
}
