import { useSyncExternalStore } from "react";
import type { DigestAction } from "@/lib/notifications/editorial";
import { AdminApiError, moveAdminDigest, saveAdminDigest, type AdminDigest, type AdminDigestWords } from "./admin-api";

type DigestSnapshot = {
	/** The edition as the library last answered. */
	digest: AdminDigest;
	/** The text on screen, which can be ahead of what is saved. */
	words: AdminDigestWords;
	/** Why the last save or step was refused. */
	problem: string | null;
	/** Someone else changed the edition. Nothing saves until it is loaded again. */
	stale: boolean;
	/** The step under way. */
	busy: DigestAction | null;
};

const SAVE_AFTER_MS = 700;

/**
 * One open edition while a person works on it. The text on screen is saved a moment after they stop typing, one save
 * at a time, each from the revision the last one returned. A step such as publishing saves first. It lives outside
 * React because both admin panes read it and the timer and the saves run between renders.
 */
export class DigestSession {
	private static started = 0;
	readonly id: string;
	/** Tells one session from the next on the same edition, so the editor starts again from the text just loaded. */
	readonly key = ++DigestSession.started;
	private snapshot: DigestSnapshot;
	private readonly listeners = new Set<() => void>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private unsaved = false;
	private sending = false;
	private saving: Promise<void> = Promise.resolve();

	constructor(digest: AdminDigest, words: AdminDigestWords) {
		this.id = digest.id;
		this.snapshot = { digest, words, problem: null, stale: false, busy: null };
	}

	readonly subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	};
	readonly read = () => this.snapshot;

	private set(patch: Partial<DigestSnapshot>) {
		this.snapshot = { ...this.snapshot, ...patch };
		for (const listener of this.listeners) listener();
	}

	private refuse(error: unknown) {
		// The library names the field it refused and why; that says more than its general message.
		const field = error instanceof AdminApiError ? Object.values(error.fields)[0] : undefined;
		this.set({
			problem: field ?? (error instanceof Error ? error.message : "The digest could not be saved. Try again."),
			stale: this.snapshot.stale || (error instanceof AdminApiError && error.code === "conflict"),
		});
	}

	change(patch: Partial<AdminDigestWords>) {
		this.unsaved = true;
		this.set({ words: { ...this.snapshot.words, ...patch } });
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), SAVE_AFTER_MS);
	}

	/**
	 * Sends what is on screen as the page is left, without waiting for the pause after typing: the request outlives the
	 * page. True when nothing is left behind, false when text stays unsaved: the library refused it, someone else changed
	 * the edition, or a save is still on its way and this text is newer.
	 */
	leave() {
		clearTimeout(this.timer);
		if (!this.unsaved) return true;
		if (this.snapshot.stale || this.snapshot.problem !== null || this.sending) return false;
		this.unsaved = false;
		// A page kept in the browser's back and forward cache comes back with this session, so it takes the answer as any save's.
		void saveAdminDigest(this.id, this.snapshot.digest.revision, this.snapshot.words, true)
			.then((digest) => this.set({ digest, problem: null }), (error) => { this.unsaved = true; this.refuse(error); });
		return true;
	}

	/** Nothing typed waits to be saved and no step is under way, so a newer answer from the library can take this one's place. */
	get settled() {
		return !this.unsaved && this.snapshot.busy === null;
	}

	/** Sends what is on screen if it has changed. False when the library refused it or someone else changed the edition. */
	private async write() {
		if (this.snapshot.stale) return false;
		if (!this.unsaved) return true;
		this.unsaved = false;
		this.sending = true;
		try {
			this.set({ digest: await saveAdminDigest(this.id, this.snapshot.digest.revision, this.snapshot.words), problem: null });
			return true;
		} catch (error) {
			this.unsaved = true;
			this.refuse(error);
			return false;
		} finally {
			this.sending = false;
		}
	}

	/** Saves what is on screen, after any save or step already on its way. */
	save() {
		clearTimeout(this.timer);
		this.saving = this.saving.then(async () => { await this.write(); });
		return this.saving;
	}

	/** Sends for review, takes back, sends back or publishes, once the text on screen is saved. True when it happened. */
	async move(action: DigestAction) {
		this.set({ busy: action });
		clearTimeout(this.timer);
		let moved = false;
		// The step takes its turn with the saves, so a save never goes out from the revision the step is about to change.
		this.saving = this.saving.then(async () => {
			try {
				// Text the library refused stays on screen with the reason; the step waits for it.
				if (!(await this.write())) return;
				const digest = await moveAdminDigest(this.id, this.snapshot.digest.revision, action);
				// Text typed while the step was on its way stays on screen, and is saved after it.
				this.set({ digest, words: this.unsaved ? this.snapshot.words : digest.words ?? this.snapshot.words, problem: null });
				moved = true;
			} catch (error) {
				this.refuse(error);
			} finally {
				this.set({ busy: null });
			}
		});
		await this.saving;
		return moved;
	}
}

const idle = () => () => {};
const none = () => null;

/** The session's snapshot for a component, kept current as the person types and saves. Null while no edition is being worked on. */
export function useDigestSnapshot(session: DigestSession | null) {
	return useSyncExternalStore(session ? session.subscribe : idle, session ? session.read : none, none);
}
