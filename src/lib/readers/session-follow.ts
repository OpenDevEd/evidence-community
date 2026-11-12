/**
 * A community on Openscholar's own site follows the Openscholar session: whoever is signed in there is signed in
 * here, and nobody is once they sign out there. Clerk keeps a cookie on the whole site that changes whenever its
 * session does (`openScholarSessionCookie`); this is what a page does about the value it reads.
 */

/** Where this browser keeps the cookie value it last acted on, so each change is followed once. */
export const SEEN_KEY = "openscholar-session-seen";
/** Set when the reader signs out here, so their next sign-in asks which account instead of taking the one Openscholar still holds. */
export const ASK_AGAIN_KEY = "openscholar-sign-in-asks";
/** Set when the reader starts a sign-in themselves: the session they come back with needs no second, hidden sign-in. */
export const SIGNING_IN_KEY = "openscholar-signing-in";
/** The cookie value a hidden sign-in last failed for and how many times, as "<value>:<times>". */
export const TRIES_KEY = "openscholar-session-tries";
/** Hidden sign-ins tried for one cookie value before giving up on it: Clerk can't always answer without its sign-in page. */
export const TRIES_MAX = 3;
/** How long the header takes to slide to its new width when the reader changes in place (`NavbarActionSteps.tsx`). */
export const HEADER_SLIDE_MS = 200;
/** Where the hidden sign-in ends: a small file of this community, so nothing of the site loads twice. */
export const QUIET_SIGN_IN_END = "/robots.txt";

/**
 * `stamp` is the cookie's value now (null when this page can't read it, "0" when nobody is signed in), `seen` the
 * one last followed, `tries` the hidden sign-ins that failed for this value, and `asked` whether the reader signed
 * out here themselves.
 */
export function followStep({ stamp, seen, signedIn, tries, asked }: { stamp: string | null; seen: string | null; signedIn: boolean; tries: number; asked: boolean }): "none" | "sign-in" | "sign-out" {
	if (stamp === null) return "none";
	if (stamp === "0") return signedIn && seen !== "0" ? "sign-out" : "none";
	if (tries >= TRIES_MAX) return "none";
	if (stamp !== seen) return "sign-in";
	// OpenScholar's session is the one followed. A reader whose session here was lost since signs in again; one who signed out here doesn't.
	return !signedIn && !asked ? "sign-in" : "none";
}

/** How many hidden sign-ins failed for this cookie value, from what `TRIES_KEY` keeps. */
export function triesFor(stamp: string | null, kept: string | null) {
	const [value, times] = (kept ?? "").split(":");
	return stamp !== null && value === stamp ? Number(times) || 0 : 0;
}

export function readCookie(name: string): string | null {
	const found = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
	return found ? found.slice(name.length + 1) : null;
}

/** Browser storage that may be turned off: a browser that keeps nothing follows every change again, which is harmless. */
export const kept = {
	get(key: string) {
		try {
			return window.localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set(key: string, value: string | null) {
		try {
			if (value === null) window.localStorage.removeItem(key);
			else window.localStorage.setItem(key, value);
		} catch {
			// Nothing to keep it in.
		}
	},
};
