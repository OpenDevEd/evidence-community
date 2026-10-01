"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { readerAuthClient } from "@/lib/readers/client";

/** Who is signed in, as other readers may see them: never their email. */
export type Reader = { id: string; name: string; image: string | null };

const ServerReader = createContext<Reader | null>(null);

/** The server reads the session with the page, so the header is right on its first frame. */
export function ReaderSessionProvider({ reader, children }: { reader: Reader | null; children: ReactNode }) {
	return <ServerReader value={reader}>{children}</ServerReader>;
}

export function useReaderSession() {
	const serverReader = useContext(ServerReader);
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
		signOut: async () => {
			await readerAuthClient.signOut();
		},
	};
}

/** The OpenScholar account page, where readers change their name, avatar and sign-in settings. */
export function useOpenScholarAccountUrl() {
	return useLibraryConfig().authentication.openScholar.accountUrl;
}
