"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { readerAuthClient } from "@/lib/readers/client";

/** Who is signed in, as other readers may see them: never their email. */
export type Reader = { id: string; name: string; image: string | null };

const ServerReader = createContext<Reader | null>(null);
/** Whether the reader has a role here above viewer, and a way to ask again. */
const ReaderAdmin = createContext<{ admin: boolean; refresh: () => void }>({ admin: false, refresh: () => {} });

/** The server reads the session with the page, so the header is right on its first frame. */
export function ReaderSessionProvider({ reader, admin, children }: { reader: Reader | null; admin: boolean; children: ReactNode }) {
	// The server's answer until the menu asks again (`refresh`), as it does each time it opens.
	const [live, setLive] = useState<boolean | null>(null);
	const refresh = () =>
		void fetch("/api/reader/team", { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((body: { admin?: boolean } | null) => { if (body) setLive(body.admin === true); })
			.catch(() => {});
	return (
		<ServerReader value={reader}>
			<ReaderAdmin value={{ admin: live ?? admin, refresh }}>{children}</ReaderAdmin>
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
export type ReaderLinks = { accountUrl: string; admin: boolean; joinUrl: string; refreshTeam: () => void };

/** This site's language as OpenScholar names it: its Chinese is "cn" here and "zh" there. */
const openScholarLocale = (locale: string) => (locale === "cn" ? "zh" : locale);

export function useReaderLinks(): ReaderLinks {
	const { accountUrl, siteUrl, libraryId } = useLibraryConfig().authentication.openScholar;
	const team = useContext(ReaderAdmin);
	// The reader's language goes along, for OpenScholar to use when it has none of theirs yet.
	const joinUrl = new URL(`/evidence-communities?apply=${libraryId}&hl=${openScholarLocale(useLocale())}`, siteUrl).toString();
	return { accountUrl, admin: team.admin, joinUrl, refreshTeam: team.refresh };
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

