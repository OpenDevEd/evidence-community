"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { readerAuthClient } from "@/lib/readers/client";

/** Who is signed in, as other readers may see them: never their email. */
export type Reader = { id: string; name: string; image: string | null };

const ServerReader = createContext<Reader | null>(null);
const ReaderAdmin = createContext(false);

/** The server reads the session with the page, so the header is right on its first frame. */
export function ReaderSessionProvider({ reader, admin, children }: { reader: Reader | null; admin: boolean; children: ReactNode }) {
	return (
		<ServerReader value={reader}>
			<ReaderAdmin value={admin}>{children}</ReaderAdmin>
		</ServerReader>
	);
}

/** The OpenScholar account page, where readers change their name, avatar and sign-in settings. */
export function useOpenScholarAccountUrl() {
	return useLibraryConfig().authentication.openScholar.accountUrl;
}

/**
 * Where the reader's menu leads: their OpenScholar account, and this library's team. `admin` with a role above
 * viewer, which opens /admin; anyone else applies to join at `joinUrl`, OpenScholar's Communities page with the
 * dialog to apply to this one open.
 */
export type ReaderLinks = { accountUrl: string; admin: boolean; joinUrl: string };

export function useReaderLinks(): ReaderLinks {
	const { accountUrl, siteUrl, libraryId } = useLibraryConfig().authentication.openScholar;
	return { accountUrl, admin: useContext(ReaderAdmin), joinUrl: new URL(`/evidence-communities?apply=${libraryId}`, siteUrl).toString() };
}

export function useReaderSession() {
	const serverReader = useContext(ServerReader);
	const router = useRouter();
	const { data, isPending } = readerAuthClient.useSession();
	const reader: Reader | null = isPending
		? serverReader
		: data
			? { id: data.user.id, name: data.user.name, image: data.user.image ?? null }
			: null;
	return {
		reader,
		/** Goes to OpenScholar only when the reader asks to sign in, and comes back to this page. */
		signIn: () =>
			void readerAuthClient.signIn.social({
				provider: "openscholar",
				callbackURL: `${window.location.pathname}${window.location.search}`,
			}),
		/** Signs out, then reloads what the server rendered for the reader, such as their private collections. */
		signOut: async () => {
			await readerAuthClient.signOut();
			router.refresh();
		},
	};
}

/** Builds an address on the OpenScholar this library belongs to, from a path there. No link names a host of its own. */
export function useOpenScholarUrl() {
	const site = useLibraryConfig().authentication.openScholar.siteUrl;
	return (path = "/") => new URL(path, site).toString();
}

