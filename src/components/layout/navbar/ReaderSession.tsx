"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSWRConfig } from "swr";

import { toast } from "@/components/layout/Toast";
import { useLibraryConfig, useLibraryFeature } from "@/context/LibraryConfigProvider";
import { getPathname } from "@/i18n/routing";
import { normalizePathname } from "@/lib/path";
import { readerAuthClient } from "@/lib/readers/client";
import { parseJoinStanding, type JoinStanding } from "@/lib/readers/join";
import { askAgain, followStep, HEADER_SLIDE_MS, keepOutcome, kept, markSignedOut, QUIET_SIGN_IN_END, readCookie, SEEN_KEY, SIGNING_IN_KEY, takeSignedOut, TRIES_KEY, triesFor } from "@/lib/readers/session-follow";

/** Who is signed in, as other readers may see them: never their email. */
export type Reader = { id: string; name: string; image: string | null };

const ServerReader = createContext<Reader | null>(null);
/** Whether the reader has a role here above viewer, where they stand with joining, and a way to ask again. */
const ReaderAdmin = createContext<{ admin: boolean; join: JoinStanding; refresh: () => void }>({ admin: false, join: "open", refresh: () => {} });

/** What one reader's standing says of anyone else: whether the community takes applications, never that theirs waits. */
const othersJoin = (join: JoinStanding): JoinStanding => (join === "closed" ? "closed" : "open");

/**
 * Who is signed in here, as the page knows it now. The server's answer stands only until this browser has read the
 * session itself. After that, a session being read again while nobody is signed in reports itself pending too, and
 * the server's answer is from before whatever the page has done since: falling back to it would show the last reader
 * again for a moment.
 */
function useReaderHere(reader: Reader | null) {
	const session = readerAuthClient.useSession();
	const [readHere, setReadHere] = useState(false);
	if (!session.isPending && !readHere) setReadHere(true);
	const servedReader = readHere ? null : reader;
	return {
		servedReader,
		pending: session.isPending,
		readerId: session.isPending ? (servedReader?.id ?? null) : (session.data?.user.id ?? null),
		sessionId: session.data?.session.id ?? null,
	};
}

/**
 * Says the reader is signed out on the page a sign-out comes back to (`signOut` below). This tab's storage and the
 * toast are the outside systems: the sign-out leaves a mark in one, and the page shows the other once.
 */
function useSignedOutNotice() {
	const said = useTranslations("ui")("signedOutHereAndOnOpenScholar");
	useEffect(() => {
		if (takeSignedOut()) toast({ title: said });
	}, [said]);
}

/** The server reads the session with the page, so the header is right on its first frame. */
export function ReaderSessionProvider({ reader, admin, join, children }: { reader: Reader | null; admin: boolean; join: JoinStanding; children: ReactNode }) {
	// The server's answer until the menu asks again (`refresh`), as it does each time it opens. Both are one reader's:
	// once the session is someone else's, or no one's (a sign-out in another tab), neither is said of them.
	const [heard, setHeard] = useState<{ reader: string | null; admin: boolean; join: JoinStanding } | null>(null);
	const { servedReader, pending, readerId, sessionId } = useReaderHere(reader);
	const live = heard && heard.reader === readerId ? heard : null;
	const served = readerId === (reader?.id ?? null) ? { admin, join } : { admin: false, join: othersJoin(join) };
	const refresh = useCallback(
		() =>
			void fetch("/api/reader/team", { cache: "no-store" })
				.then((response) => (response.ok ? response.json() : null))
				.then((body: { admin?: boolean; join?: unknown } | null) => { if (body) setHeard({ reader: readerId, admin: body.admin === true, join: parseJoinStanding(body.join) }); })
				.catch(() => {}),
		[readerId],
	);
	// The window coming back into focus, or its tab coming back into view, is the outside system: a reader who applied
	// on OpenScholar in another tab returns to a page that already says their application was sent.
	const signedIn = readerId !== null;
	useEffect(() => {
		if (!signedIn) return;
		const back = () => { if (document.visibilityState === "visible") refresh(); };
		window.addEventListener("focus", back);
		document.addEventListener("visibilitychange", back);
		return () => {
			window.removeEventListener("focus", back);
			document.removeEventListener("visibilitychange", back);
		};
	}, [signedIn, refresh]);
	useFollowOpenScholarSession(pending ? undefined : readerId, sessionId);
	useReadAgainForReader(readerId);
	useSignedOutNotice();
	return (
		<ServerReader value={servedReader}>
			<ReaderAdmin value={{ admin: live?.admin ?? served.admin, join: live?.join ?? served.join, refresh }}>{children}</ReaderAdmin>
		</ServerReader>
	);
}

/** One hidden sign-in at a time, whichever window event asked for it. */
let following = false;
/** The reader's own sign-in has started and the page is leaving: a hidden one started now would replace the state the library checks theirs against. */
let leaving = false;

/** The start of a hidden sign-in still on its way to the library: the reader's own waits for it, so the state the library keeps for theirs is the last one set. */
let starting: Promise<unknown> | null = null;

/**
 * Says in the console why the session wasn't followed, for whoever looks into one that didn't: what was tried and
 * how far it got. The library's own log has the rest (a sign-in the library refused is logged there). Nothing here
 * names the reader.
 */
function noteNotFollowed(detail: Record<string, unknown>) {
	console.warn(JSON.stringify({ event: "openscholar-session-not-followed", ...detail }));
}

/**
 * The same sign-in the button starts, in a frame nobody sees. Clerk answers it at once for whoever is signed in to
 * OpenScholar, the library makes its session as for any sign-in, and the page never leaves. The frame ends on a small
 * file of this site when it worked, and on Clerk's sign-in page when it didn't; either way it has loaded. `started`
 * is false when the sign-in couldn't start: the library takes only a few at once from one address.
 */
async function signInQuietly(): Promise<{ started: boolean; detail: Record<string, unknown> }> {
	const start = readerAuthClient.signIn.social({ provider: "openscholar", callbackURL: QUIET_SIGN_IN_END, errorCallbackURL: QUIET_SIGN_IN_END, disableRedirect: true });
	starting = start;
	const { data, error } = await start.finally(() => { starting = null; });
	if (!data?.url) return { started: false, detail: { stage: "start", status: error?.status ?? null } };
	const frame = document.createElement("iframe");
	frame.hidden = true;
	frame.src = data.url;
	const frameEnd = await new Promise<"loaded" | "timed out">((done) => {
		frame.addEventListener("load", () => done("loaded"), { once: true });
		window.setTimeout(() => done("timed out"), 10_000);
		document.body.append(frame);
	});
	frame.remove();
	return { started: true, detail: { stage: "frame", frameEnd } };
}

/** Who is signed in here, as the page has read it: undefined until it has. */
type Here = { readerId: string | null; sessionId: string | null } | undefined;

/** What to do about OpenScholar's session as its cookie reads now. A value there is nothing to do about is kept as followed. */
function stepFor(stamp: string | null, here: NonNullable<Here>) {
	// Back from the sign-in the reader asked for: the session it made is OpenScholar's as it is now.
	const step =
		here.readerId && kept.get(SIGNING_IN_KEY)
			? "none"
			: followStep({ stamp, seen: kept.get(SEEN_KEY), signedIn: here.readerId !== null, tries: triesFor(stamp, kept.get(TRIES_KEY)), asked: askAgain.get() });
	if (here.readerId) kept.set(SIGNING_IN_KEY, null);
	if (step === "none" && stamp !== null) kept.set(SEEN_KEY, stamp);
	return step;
}

/** Does the step itself. `started` is false for a sign-in that couldn't start. */
async function attempt(step: "sign-in" | "sign-out") {
	if (step === "sign-in") return signInQuietly();
	await readerAuthClient.signOut();
	return { started: true, detail: { stage: "sign-out" } };
}

/**
 * Takes the step, and says whether the reader is someone else afterwards. The value counts as followed only once the
 * step is seen to have worked: a session that isn't the one before, or none after a sign-out. One that didn't is
 * tried again the next time the page is looked at, a few times (`TRIES_MAX`).
 */
async function takeStep(step: "sign-in" | "sign-out", stamp: string, here: NonNullable<Here>) {
	const { started, detail } = await attempt(step);
	// A sign-in that couldn't start says nothing about OpenScholar: it doesn't count as a try.
	if (!started) return noteNotFollowed({ step, ...detail }), false;
	const { data, error } = await readerAuthClient.getSession({ query: { disableCookieCache: true } });
	// A session that couldn't be read says nothing either way: nothing is counted, and the next look asks again.
	if (error) return noteNotFollowed({ step, stage: "session", status: error.status ?? null }), false;
	const worked = step === "sign-out" ? !data : !!data && data.session.id !== here.sessionId;
	const tries = keepOutcome(stamp, worked);
	if (!worked) noteNotFollowed({ step, ...detail, signedIn: !!data, tries });
	return (data?.user.id ?? null) !== here.readerId;
}

/**
 * Keeps this library's session the same as OpenScholar's, on a community that can read OpenScholar's session cookie
 * (`sessionCookie`): signed in as whoever is signed in there, signed out once they sign out there. The outside
 * systems are that cookie, the hidden sign-in frame, and the window coming back into view, which is when a change
 * made on OpenScholar in another tab is noticed.
 */
function useFollowOpenScholarSession(readerId: string | null | undefined, sessionId: string | null) {
	const { sessionCookie } = useLibraryConfig().authentication.openScholar;
	// Only where readers have accounts: a community without them signs nobody in but its admins, who ask to be.
	const readerAccounts = useLibraryFeature("readerAccounts");
	useEffect(() => {
		if (readerId) askAgain.set(false);
		if (!sessionCookie || !readerAccounts || readerId === undefined) return;
		const here = { readerId, sessionId };
		const follow = async () => {
			if (following || leaving || document.visibilityState !== "visible") return;
			const stamp = readCookie(sessionCookie);
			const step = stepFor(stamp, here);
			if (step === "none" || stamp === null) return;
			following = true;
			try {
				// The header changes only when the reader did. A sign-out has already told the page's session to read itself
				// again; the hidden sign-in happened in a frame, so the page is told here.
				if ((await takeStep(step, stamp, here)) && step === "sign-in") readerAuthClient.$store.notify("$sessionSignal");
			} catch (error) {
				// OpenScholar or the network didn't answer: the session stays as it was, and the button still works.
				noteNotFollowed({ step, stage: "error", error: String(error).slice(0, 200) });
			} finally {
				following = false;
			}
		};
		// Back from OpenScholar's sign-in page without signing in, to this page as the browser kept it: it isn't leaving any more.
		const restored = (event: PageTransitionEvent) => {
			if (!event.persisted) return;
			leaving = false;
			void follow();
		};
		void follow();
		window.addEventListener("focus", follow);
		window.addEventListener("pageshow", restored);
		document.addEventListener("visibilitychange", follow);
		return () => {
			window.removeEventListener("focus", follow);
			window.removeEventListener("pageshow", restored);
			document.removeEventListener("visibilitychange", follow);
		};
	}, [sessionCookie, readerAccounts, readerId, sessionId]);
}

/**
 * Reads the page again when the reader changes while it is open, whatever changed them: the session followed here,
 * a sign-in or sign-out in another tab of this community. What the page had read for the last reader, their
 * bookmarks and private collections, goes with them, and everything it shows is read again as the new one; for
 * someone signing in, what anyone may see stays up meanwhile. The outside system is the session, which other tabs
 * change too.
 */
function useReadAgainForReader(readerId: string | null) {
	const router = useRouter();
	const { mutate } = useSWRConfig();
	const last = useRef(readerId);
	useEffect(() => {
		const before = last.current;
		if (before === readerId) return;
		last.current = readerId;
		// The header slides to the new reader first; drawing the page again at the same moment would take its frames.
		const later = window.setTimeout(() => {
			void (before ? mutate(() => true, undefined, { revalidate: true }) : mutate(() => true));
			router.refresh();
		}, HEADER_SLIDE_MS);
		return () => window.clearTimeout(later);
	}, [readerId, mutate, router]);
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
	const { siteUrl, sessionCookie } = useLibraryConfig().authentication.openScholar;
	const { data, isPending } = readerAuthClient.useSession();
	const locale = useLocale();
	const reader: Reader | null = isPending
		? serverReader
		: data
			? { id: data.user.id, name: data.user.name, image: data.user.image ?? null }
			: null;
	/** Where sign-in comes back to: this page, with what the reader was opening (`suggest`) in its address. */
	const signInTo = async (suggest?: string) => {
		const back = new URL(window.location.href);
		if (suggest !== undefined) back.searchParams.set(SUGGEST_PARAM, suggest);
		leaving = true;
		await starting?.catch(() => null);
		const { data: started } = await readerAuthClient.signIn.social({ provider: "openscholar", callbackURL: `${back.pathname}${back.search}`, disableRedirect: true }).catch(() => ({ data: null }));
		if (!started?.url) return void (leaving = false);
		kept.set(SIGNING_IN_KEY, "1");
		const signIn = new URL(started.url);
		// After signing out here, Clerk asks who is signing in instead of taking the account it still holds: the way to switch accounts.
		if (askAgain.get()) signIn.searchParams.set("prompt", "login");
		window.location.assign(signIn);
	};
	const home = () => new URL(getPathname({ href: "/", locale }), window.location.origin).toString();
	/** Signs out here, then of OpenScholar, whose sign-out page comes back to `back`. `say` leaves the notice for that page. */
	const leave = async (back: string, say: boolean) => {
		await readerAuthClient.signOut();
		askAgain.set(true);
		if (say) markSignedOut();
		// Where OpenScholar is known to be signed out already, there is nothing to sign out of there.
		if (sessionCookie && readCookie(sessionCookie) === "0") return back === window.location.href ? window.location.reload() : window.location.assign(back);
		const signOut = new URL("/sign-out", siteUrl);
		signOut.searchParams.set("redirect_url", back);
		window.location.assign(signOut);
	};
	return {
		reader,
		/** Goes to OpenScholar only when the reader asks to sign in, and comes back to this page. */
		signIn: () => void signInTo(),
		/** The same, coming back with the Suggest papers dialog open on the text given. */
		signInToSuggest: (text = "") => void signInTo(text),
		/**
		 * Signs out here and of OpenScholar, whose sign-out page comes straight back to this one: a reader signed out
		 * of one is signed out of both, and the next sign-in can be another account. The page loads again on the way
		 * back, without what the server rendered for the reader, such as their private collections, and says they're
		 * signed out (`useSignedOutNotice`). From their own profile they come back to the home page instead: anyone can
		 * read a profile, so their name and bookmarks would still be there, as if they hadn't signed out.
		 */
		signOut: () => leave(reader && normalizePathname(window.location.pathname).endsWith(`/profile/${reader.id}`) ? home() : window.location.href, true),
		/** The same from a page only some may open, such as /admin: to the home page, since that page would only ask them to sign in again. */
		signOutToHome: () => leave(home(), true),
		/**
		 * For someone signed in who may not open this page: signs out of both and comes back here, where sign-in now asks
		 * who is signing in. Nothing says they're signed out: the next page they see is the one they signed in to reach.
		 */
		switchAccount: () => leave(window.location.href, false),
	};
}

/** Builds an address on the OpenScholar this library belongs to, from a path there. No link names a host of its own. */
export function useOpenScholarUrl() {
	const site = useLibraryConfig().authentication.openScholar.siteUrl;
	return (path = "/") => new URL(path, site).toString();
}

