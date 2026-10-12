import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import CollectionInvitation, { type InvitationView } from "@/components/pages/CollectionInvitation";
import { getDatabaseForConfig } from "@/db";
import { readCollectionInvitation } from "@/lib/readers/collection-invitations";
import { invitationStanding, readCollectionForInvitation } from "@/lib/readers/data";
import type { Database } from "@/db/database-schema";
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

type CollectionView = Extract<InvitationView, { collection: unknown }>;

/**
 * An accepted invitation as the reader stands now: their role in the collection today, which the owner may have
 * changed since; gone once the owner took them out; or as accepted while the library never recorded it, which Open
 * finishes.
 */
async function standingView(database: Database, invitationId: string, readerId: string, view: CollectionView): Promise<InvitationView> {
	if (view.state === "pending") return view;
	const standing = await invitationStanding(database, invitationId, view.collection.id, readerId);
	if (standing === "ended") return { state: "gone" };
	return standing === "unrecorded" ? view : { ...view, role: standing };
}

/**
 * What the invitation is to, as the signed-in reader may see it. The link
 * alone says nothing: it may have been passed on. Only an account with the
 * invited address learns which collection it is.
 */
async function readView(config: LibraryServerConfig, invitationId: string, viewer: { id: string; clerkUserId: string }): Promise<InvitationView> {
	try {
		const invitation = await readCollectionInvitation(config.authentication.openScholar, invitationId, viewer.clerkUserId);
		if (!("collectionId" in invitation)) return invitation;
		const database = await getDatabaseForConfig(config);
		const collection = await readCollectionForInvitation(database, invitation.collectionId);
		return collection ? standingView(database, invitationId, viewer.id, { state: invitation.state, role: invitation.role, collection }) : { state: "gone" };
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
	const view = viewer ? await readView(config, id, viewer) : { state: "signedOut" as const };
	return <CollectionInvitation invitationId={id} view={view} />;
}
