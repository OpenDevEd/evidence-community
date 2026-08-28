"use client";

import {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	type RefObject,
} from "react";

/** The tallest the message field grows before it scrolls itself. */
const MAX_COMPOSER_HEIGHT = 144;
/** Below this width the column is still opening, so do not measure. */
const SETTLED_COMPOSER_WIDTH = 200;
/** If nothing pulls the scroll back, go to the newest message anyway. */
const REARM_FALLBACK_MS = 150;
/** Runs after the scroll hook's own handler for the same event. */
const REARM_SCROLL_MS = 10;
/** How long to wait for the column width to stop changing. */
const SETTLE_MS = 90;

/** Finds the message field inside the form around it. */
function composerTextarea(form: RefObject<HTMLFormElement | null>) {
	return form.current?.querySelector("textarea") ?? null;
}

/**
 * The message field sizes itself. The one NextUI ships mis-measures on focus
 * in Firefox, growing an empty field to several rows.
 */
function useComposerAutosize(composerFormRef: RefObject<HTMLFormElement | null>) {
	const resizeComposer = useCallback(() => {
		const element = composerTextarea(composerFormRef);
		if (!element) return;

		// While the column is still opening, let the row count decide: the
		// placeholder would otherwise measure as dozens of wrapped lines.
		if (!element.value && element.clientWidth < SETTLED_COMPOSER_WIDTH) {
			element.style.height = "";

			return;
		}

		element.style.height = "0px";
		element.style.height = `${Math.min(
			element.scrollHeight,
			MAX_COMPOSER_HEIGHT,
		)}px`;
	}, [composerFormRef]);

	// The column opens from almost no width, so a height measured at the
	// start sees the placeholder wrapped over many lines. Measure again once
	// the width has settled.
	useEffect(() => {
		const element = composerTextarea(composerFormRef);
		if (!element) return;

		let lastWidth = -1;
		let settle: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.contentRect.width ?? 0;
			if (width === lastWidth) return;
			lastWidth = width;
			// Measuring on every tick would make the browser lay the page out
			// again each frame while the column opens.
			clearTimeout(settle);
			settle = setTimeout(resizeComposer, SETTLE_MS);
		});

		observer.observe(element);

		return () => {
			clearTimeout(settle);
			observer.disconnect();
		};
	}, [composerFormRef, resizeComposer]);

	// Outside system: the browser's focus and caret. The field is built when
	// the split view opens, so there is no click or key press to act on.
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const element = composerTextarea(composerFormRef);
			if (!element) return;
			element.focus({ preventScroll: true });
			element.setSelectionRange(
				element.value.length,
				element.value.length,
			);
			resizeComposer();
		});

		return () => cancelAnimationFrame(frame);
	}, [composerFormRef, resizeComposer]);

	return resizeComposer;
}

/**
 * The conversation is padded by the height of the message field below it.
 * This keeps that padding in step, and keeps the reader on the newest
 * message when the field shrinks and the browser pulls the scroll back.
 */
function useDockHeight({
	isAtBottom,
	scrollToBottom,
}: {
	isAtBottom: boolean;
	scrollToBottom: () => void;
}) {
	const composerDockRef = useRef<HTMLDivElement>(null);
	const [composerDockHeight, setComposerDockHeight] = useState(0);
	const rearmOnNextScrollRef = useRef(false);
	// The observer and the timers below are set up once, but they must act on
	// what is true now, not on what was true when they were set up.
	const wasPinned = useEffectEvent(() => isAtBottom);
	const rearmStickToBottom = useEffectEvent(() => scrollToBottom());

	useLayoutEffect(() => {
		const dock = composerDockRef.current;
		if (!dock) return;

		let lastHeight = dock.offsetHeight;
		let fallback: ReturnType<typeof setTimeout> | undefined;
		setComposerDockHeight(lastHeight);

		const observer = new ResizeObserver(() => {
			const height = dock.offsetHeight;
			const shrank = height < lastHeight;
			lastHeight = height;
			setComposerDockHeight(height);
			if (!shrank || !wasPinned()) return;

			// The padding shrinks in a later paint, and the browser's own
			// scroll correction comes after that, so wait for it.
			rearmOnNextScrollRef.current = true;
			clearTimeout(fallback);
			fallback = setTimeout(() => {
				if (!rearmOnNextScrollRef.current) return;
				rearmOnNextScrollRef.current = false;
				rearmStickToBottom();
			}, REARM_FALLBACK_MS);
		});

		observer.observe(dock);

		return () => {
			clearTimeout(fallback);
			observer.disconnect();
		};
	}, []);

	const [scrolled, setScrolled] = useState<HTMLElement | null>(null);
	const watchDockClamp = useCallback(
		(element: HTMLElement | null) => setScrolled(element),
		[],
	);

	// Outside system: the message list's own scrolling, which the browser
	// corrects after the padding shrinks.
	useEffect(() => {
		if (!scrolled) return;

		const onClampScroll = () => {
			if (!rearmOnNextScrollRef.current) return;
			rearmOnNextScrollRef.current = false;
			setTimeout(() => rearmStickToBottom(), REARM_SCROLL_MS);
		};

		scrolled.addEventListener("scroll", onClampScroll);

		return () => scrolled.removeEventListener("scroll", onClampScroll);
	}, [scrolled]);

	return { composerDockHeight, composerDockRef, watchDockClamp };
}

/** The message field docked to the bottom of the conversation. */
export function useComposerDock({
	isAtBottom,
	scrollToBottom,
}: {
	isAtBottom: boolean;
	scrollToBottom: () => void;
}) {
	const composerFormRef = useRef<HTMLFormElement>(null);
	const resizeComposer = useComposerAutosize(composerFormRef);
	const dock = useDockHeight({ isAtBottom, scrollToBottom });

	return { ...dock, composerFormRef, resizeComposer };
}
