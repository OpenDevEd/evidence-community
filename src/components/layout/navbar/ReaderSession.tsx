"use client";

import { useRouter } from "next/navigation";
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

/** The OpenScholar account page, where readers change their name, avatar and sign-in settings. */
export function useOpenScholarAccountUrl() {
	return useLibraryConfig().authentication.openScholar.accountUrl;
}
