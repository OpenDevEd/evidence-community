"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { readerAuthClient } from "@/lib/readers/client";
import { parseJoinStanding, type JoinStanding } from "@/lib/readers/join";

/** Who is signed in, as other readers may see them: never their email. */
export type Reader = { id: string; name: string; image: string | null };

const ServerReader = createContext<Reader | null>(null);
/** Whether the reader has a role here above viewer, where they stand with joining, and a way to ask again. */
const ReaderAdmin = createContext<{ admin: boolean; join: JoinStanding; refresh: () => void }>({ admin: false, join: "open", refresh: () => {} });

/** The server reads the session with the page, so the header is right on its first frame. */
export function ReaderSessionProvider({ reader, admin, join, children }: { reader: Reader | null; admin: boolean; join: JoinStanding; children: ReactNode }) {
	// The server's answer until the menu asks again (`refresh`), as it does each time it opens.
	// Kept with whose it is: signing out or in leaves the last reader's answer behind, for the server's own.
	const [heard, setHeard] = useState<{ reader: string | null; admin: boolean; join: JoinStanding } | null>(null);
	const readerId = reader ? reader.id : null;
	const live = heard && heard.reader === readerId ? heard : null;
	const refresh = useCallback(
		() =>
			void fetch("/api/reader/team", { cache: "no-store" })
				.then((response) => (response.ok ? response.json() : null))
				.then((body: { admin?: boolean; join?: unknown } | null) => { if (body) setHeard({ reader: readerId, admin: body.admin === true, join: parseJoinStanding(body.join) }); })
				.catch(() => {}),
		[readerId],
	);
	// The window coming back into focus is the outside system: a reader who applied on OpenScholar in another tab
	// returns to a page that already says their application was sent.
	const signedIn = reader !== null;
	useEffect(() => {
		if (!signedIn) return;
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [signedIn, refresh]);
	return (
		<ServerReader value={reader}>
			<ReaderAdmin value={{ admin: live?.admin ?? admin, join: live?.join ?? join, refresh }}>{children}</ReaderAdmin>
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
 * dialog to apply to this one open (`openJoin`, in a new tab), unless `join` says the community takes no applications.
 */
export type ReaderLinks = { accountUrl: string; admin: boolean; join: JoinStanding; joinUrl: string; openJoin: () => void; refreshTeam: () => void };

/** This site's language as OpenScholar names it: its Chinese is "cn" here and "zh" there. */
const openScholarLocale = (locale: string) => (locale === "cn" ? "zh" : locale);

export function useReaderLinks(): ReaderLinks {
	const { accountUrl, siteUrl, libraryId } = useLibraryConfig().authentication.openScholar;
	const team = useContext(ReaderAdmin);
	// The reader's language goes along, for OpenScholar to use when it has none of theirs yet.
	const joinUrl = new URL(`/evidence-communities?apply=${libraryId}&hl=${openScholarLocale(useLocale())}`, siteUrl).toString();
	return { accountUrl, admin: team.admin, join: team.join, joinUrl, openJoin: () => void window.open(joinUrl, "_blank", "noopener"), refreshTeam: team.refresh };
}

/** The address parameter that holds the Suggest papers dialog open, with the text its field starts on. */
export const SUGGEST_PARAM = "suggest";

export function useReaderSession() {
	const serverReader = useContext(ServerReader);
	const router = useRouter();
	const { data, isPending } = readerAuthClient.useSession();
	const reader: Reader | null = isPending
		? serverReader
		: data
			? { id: data.user.id, name: data.user.name, image: data.user.image ?? null }
			: null;
	/** Where sign-in comes back to: this page, with what the reader was opening (`suggest`) in its address. */
	const signInTo = (suggest?: string) => {
		const back = new URL(window.location.href);
		if (suggest !== undefined) back.searchParams.set(SUGGEST_PARAM, suggest);
		void readerAuthClient.signIn.social({ provider: "openscholar", callbackURL: `${back.pathname}${back.search}` });
	};
	return {
		reader,
		/** Goes to OpenScholar only when the reader asks to sign in, and comes back to this page. */
		signIn: () => signInTo(),
		/** The same, coming back with the Suggest papers dialog open on the text given. */
		signInToSuggest: (text = "") => signInTo(text),
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

