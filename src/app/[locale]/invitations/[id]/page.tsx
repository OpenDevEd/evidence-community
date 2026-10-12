import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import CollectionInvitation, { type InvitationView } from "@/components/pages/CollectionInvitation";
import { getDatabaseForConfig } from "@/db";
import { readCollectionInvitation } from "@/lib/readers/collection-invitations";
import { readCollectionForInvitation } from "@/lib/readers/data";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { libraryMetadata } from "../../lib/page";

export async function generateMetadata(props: {
	params: Promise<{ id: string; locale: string }>;
	searchParams: Promise<URLSearchParams>;
}): Promise<Metadata> {
	const params = await props.params;
	return libraryMetadata({ ...props, pathname: `/invitations/${params.id}` });
}

// Each answer belongs to the signed-in reader, so nothing is prerendered.
export const instant = false;

/**
 * What the invitation is to, as the signed-in reader may see it. The link
 * alone says nothing: it may have been passed on. Only an account with the
 * invited address learns which collection it is.
 */
async function readView(config: LibraryServerConfig, invitationId: string, clerkUserId: string): Promise<InvitationView> {
	try {
		const invitation = await readCollectionInvitation(config.authentication.openScholar, invitationId, clerkUserId);
		if (!("collectionId" in invitation)) return invitation;
		const collection = await readCollectionForInvitation(await getDatabaseForConfig(config), invitation.collectionId);
		return collection ? { state: invitation.state, role: invitation.role, collection } : { state: "gone" };
	} catch (error) {
		console.error("Reading a collection invitation failed", { libraryId: config.authentication.openScholar.libraryId, invitationId, error });
		return { state: "unavailable" };
	}
}

/** Where a collection invitation email links: the invited reader signs in and opens the collection here. */
export default async function CollectionInvitationPage(props: { params: Promise<{ id: string }> }) {
	await connection();
	const config = await getConfigForEnabledFeature("readerAccounts");
	if (!config) notFound();
	const [{ id }, viewer] = await Promise.all([props.params, getSignedInOpenScholarUser(await headers(), config)]);
	const view = viewer ? await readView(config, id, viewer.clerkUserId) : { state: "signedOut" as const };
	return <CollectionInvitation invitationId={id} view={view} />;
}
