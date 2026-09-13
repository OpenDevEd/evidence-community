"use client";

import {
	useCallback,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";

// Ported from OpenScholar's configuration/use-scroll-spy. Section IDs are
// supplied directly here; the active line still follows each scroll margin.
export function useScrollSpy(ids: readonly string[], onMeasure?: () => void) {
	const [active, setActive] = useState<string | null>(null);
	const locked = useRef<string | null>(null);
	const releaseScroll = useRef<(() => void) | null>(null);
	const measureRelatedScroll = useEffectEvent(() => onMeasure?.());

	useEffect(() => {
		let frame = 0;
		const measure = () => {
			frame = 0;
			measureRelatedScroll();
			if (locked.current) return;
			let current: string | null = null;
			for (const id of ids) {
				const element = document.getElementById(id);
				if (!element) continue;
				const line =
					(Number.parseFloat(
						getComputedStyle(element).scrollMarginTop,
					) || 0) + 8;
				if (element.getBoundingClientRect().top <= line) current = id;
				else break;
			}
			if (
				window.innerHeight + window.scrollY >=
				document.documentElement.scrollHeight - 2
			) {
				current = ids[ids.length - 1] ?? current;
			}
			setActive((previous) =>
				previous === current ? previous : current,
			);
		};
		const onScroll = () => {
			if (!frame) frame = window.requestAnimationFrame(measure);
		};
		const interrupt = () => {
			releaseScroll.current?.();
			onScroll();
		};
		measure();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		window.addEventListener("wheel", interrupt, { passive: true });
		window.addEventListener("touchstart", interrupt, { passive: true });
		window.addEventListener("keydown", interrupt);
		return () => {
			releaseScroll.current?.();
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			window.removeEventListener("wheel", interrupt);
			window.removeEventListener("touchstart", interrupt);
			window.removeEventListener("keydown", interrupt);
			if (frame) window.cancelAnimationFrame(frame);
		};
	}, [ids]);

	const jumpTo = useCallback((id: string) => {
		const element = document.getElementById(id);
		if (!element) return;
		releaseScroll.current?.();
		setActive(id);
		element.focus({ preventScroll: true });
		const margin =
			Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
		const target = Math.min(
			document.documentElement.scrollHeight - window.innerHeight,
			Math.max(
				0,
				window.scrollY + element.getBoundingClientRect().top - margin,
			),
		);
		// An already-aligned section produces no scrollend event.
		if (Math.abs(window.scrollY - target) <= 1) return;
		locked.current = id;
		const onScrollEnd = (event: Event) => {
			// A separately scrolling contents panel must not unlock the page.
			if (event.target === document) release();
		};
		const release = () => {
			window.removeEventListener("scrollend", onScrollEnd);
			locked.current = null;
			releaseScroll.current = null;
		};
		releaseScroll.current = release;
		window.addEventListener("scrollend", onScrollEnd);
		element.scrollIntoView({
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
				.matches
				? "instant"
				: "smooth",
			block: "start",
		});
	}, []);

	return { active, jumpTo };
}
