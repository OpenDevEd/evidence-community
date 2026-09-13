"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Ported from OpenScholar's configuration/use-scroll-spy. Section IDs are
// supplied directly here; the active line still follows each scroll margin.
export function useScrollSpy(ids: readonly string[]) {
	const [active, setActive] = useState<string | null>(null);
	const locked = useRef<string | null>(null);
	const releaseScroll = useRef<(() => void) | null>(null);

	useEffect(() => {
		let frame = 0;
		const measure = () => {
			frame = 0;
			if (locked.current) return;
			let current: string | null = null;
			for (const id of ids) {
				const element = document.getElementById(id);
				if (!element) continue;
				const line = (Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0) + 8;
				if (element.getBoundingClientRect().top <= line) current = id;
				else break;
			}
			if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
				current = ids[ids.length - 1] ?? current;
			}
			setActive(previous => previous === current ? previous : current);
		};
		const onScroll = () => {
			if (!frame) frame = window.requestAnimationFrame(measure);
		};
		const interrupt = () => { releaseScroll.current?.(); onScroll(); };
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
		locked.current = id;
		setActive(id);
		let timer = 0;
		const release = () => {
			window.removeEventListener("scrollend", release);
			window.clearTimeout(timer);
			locked.current = null;
			releaseScroll.current = null;
		};
		releaseScroll.current = release;
		window.addEventListener("scrollend", release, { once: true });
		// A click on an already-aligned section does not produce scrollend.
		timer = window.setTimeout(release, 1200);
		element.focus({ preventScroll: true });
		element.scrollIntoView({
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
			block: "start",
		});
	}, []);

	return { active, jumpTo };
}
