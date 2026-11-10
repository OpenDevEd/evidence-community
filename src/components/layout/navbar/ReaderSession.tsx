"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { readerAuthClient } from "@/lib/readers/client";
import { joinStandingOf, type JoinStanding } from "@/lib/readers/join";

/** Who is signed in, as other readers may see them: never their email. */
export type Reader = { id: string; name: string; image: string | null };

const ServerReader = createContext<Reader | null>(null);
/** Whether the reader has a role here above viewer, where they stand with joining, and a way to ask again. */
const ReaderAdmin = createContext<{ admin: boolean; join: JoinStanding; refresh: () => void }>({ admin: false, join: "open", refresh: () => {} });

/** The server reads the session with the page, so the header is right on its first frame. */
export function ReaderSessionProvider({ reader, admin, join, children }: { reader: Reader | null; admin: boolean; join: JoinStanding; children: ReactNode }) {
	// The server's answer until the menu asks again (`refresh`), as it does each time it opens.
	const [live, setLive] = useState<{ admin: boolean; join: JoinStanding } | null>(null);
	const refresh = () =>
		void fetch("/api/reader/team", { cache: "no-store" })
			.then((response) => (response.ok ? response.json() : null))
			.then((body: { admin?: boolean; join?: unknown } | null) => { if (body) setLive({ admin: body.admin === true, join: joinStandingOf(body.join) }); })
			.catch(() => {});
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
 * dialog to apply to this one open.
 */
export type ReaderLinks = { accountUrl: string; admin: boolean; join: JoinStanding; joinUrl: string; openJoin: () => void; refreshTeam: () => void };

/** This site's language as OpenScholar names it: its Chinese is "cn" here and "zh" there. */
const openScholarLocale = (locale: string) => (locale === "cn" ? "zh" : locale);

export function useReaderLinks(): ReaderLinks {
	const { accountUrl, siteUrl, libraryId } = useLibraryConfig().authentication.openScholar;
	const team = useContext(ReaderAdmin);
	// The reader's language goes along, for OpenScholar to use when it has none of theirs yet.
	const locale = openScholarLocale(useLocale());
	// MOCK: the local stack's Openscholar is a stand-in with no pages, so Join opens a real dev community's dialog.
	const joinUrl = siteUrl.includes(".localhost")
		? `https://dev.openscholar.ai/evidence-communities?apply=r177rfndfzfvrgdgsmp4z9nn358g745k&hl=${locale}`
		: new URL(`/evidence-communities?apply=${libraryId}&hl=${locale}`, siteUrl).toString();
	const openJoin = () => {
		window.open(joinUrl, "_blank", "noopener");
		// MOCK: Openscholar will say an application is waiting once it is sent; here, opening the dialog counts as sending.
		if (team.join === "open") void fetch("/api/mock?join=waiting").then(team.refresh);
	};
	return { accountUrl, admin: team.admin, join: team.join, joinUrl, openJoin, refreshTeam: team.refresh };
}

/** The address parameter that holds the Suggest papers dialog open: empty, or the paper it opens on. */
export const SUGGEST_PARAM = "suggest";
// MOCK: true on the local stack, whose Openscholar is a stand-in.
const MOCK_SIGN_IN = typeof window !== "undefined" && window.location.hostname === "localhost";

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
		const callbackURL = `${back.pathname}${back.search}`;
		// MOCK: the local stack has no Openscholar to sign in at, so a stand-in signs a sample reader in and comes back the same way.
		if (MOCK_SIGN_IN) return window.location.assign(`/api/mock?signin=visitor&next=${encodeURIComponent(callbackURL)}`);
		void readerAuthClient.signIn.social({ provider: "openscholar", callbackURL });
	};
	return {
		reader,
		/** Goes to OpenScholar only when the reader asks to sign in, and comes back to this page. */
		signIn: () => signInTo(),
		/** The same, coming back with the Suggest papers dialog open, on the paper named if any. */
		signInToSuggest: (paper = "") => signInTo(paper),
		/** Signs out, then reloads what the server rendered for the reader, such as their private collections. */
		signOut: async () => {
			if (MOCK_SIGN_IN) return window.location.assign(`/api/mock?signin=out&next=${encodeURIComponent(window.location.pathname)}`);
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

