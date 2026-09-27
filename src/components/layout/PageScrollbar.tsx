"use client";

import { useEffect, useRef, type PointerEvent } from "react";

/**
 * The page's scrollbar, drawn over the page. The browser's own is hidden (`no-scrollbar` on `<html>`) because it takes
 * width from the page: everything, the navbar included, moved sideways between pages that scroll and pages such as the
 * map that do not. It shows while the page scrolls or under the pointer, and can be dragged.
 */
export default function PageScrollbar() {
	const thumb = useRef<HTMLDivElement>(null);
	const drag = useRef<{ pointerY: number; scrollY: number } | null>(null);

	// Follows the window's scroll position and size and the page's height.
	useEffect(() => {
		const element = thumb.current!;
		const root = document.documentElement;
		let frame = 0;
		let fade = 0;
		const place = () => {
			frame = 0;
			const { scrollHeight, clientHeight } = root;
			const scrollable = scrollHeight - clientHeight;
			element.hidden = scrollable <= 0;
			if (scrollable <= 0) return;
			const height = Math.max(40, (clientHeight * clientHeight) / scrollHeight);
			element.style.height = `${height}px`;
			element.style.transform = `translateY(${(window.scrollY / scrollable) * (clientHeight - height)}px)`;
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(place);
		};
		const scrolled = () => {
			schedule();
			element.dataset.active = "";
			clearTimeout(fade);
			fade = window.setTimeout(() => delete element.dataset.active, 900);
		};
		const pageSize = new ResizeObserver(schedule);
		pageSize.observe(document.body);
		window.addEventListener("scroll", scrolled, { passive: true });
		window.addEventListener("resize", schedule);
		place();
		return () => {
			pageSize.disconnect();
			window.removeEventListener("scroll", scrolled);
			window.removeEventListener("resize", schedule);
			cancelAnimationFrame(frame);
			clearTimeout(fade);
		};
	}, []);

	function startDrag(event: PointerEvent<HTMLDivElement>) {
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { pointerY: event.clientY, scrollY: window.scrollY };
	}
	function moveDrag(event: PointerEvent<HTMLDivElement>) {
		if (!drag.current) return;
		const { scrollHeight, clientHeight } = document.documentElement;
		const track = clientHeight - event.currentTarget.offsetHeight;
		window.scrollTo(0, drag.current.scrollY + ((event.clientY - drag.current.pointerY) * (scrollHeight - clientHeight)) / track);
	}

	return (
		<div
			ref={thumb}
			aria-hidden
			hidden
			onPointerDown={startDrag}
			onPointerMove={moveDrag}
			onPointerUp={() => (drag.current = null)}
			onPointerCancel={() => (drag.current = null)}
			className="group fixed right-0 top-0 z-50 w-3 touch-none select-none p-0.5 opacity-0 transition-opacity duration-300 hover:opacity-100 active:opacity-100 data-[active]:opacity-100 motion-reduce:transition-none"
		>
			<div className="h-full rounded-full bg-[rgba(127,127,127,0.6)] transition-[width,margin] group-hover:ml-0 group-active:ml-0 ml-1 w-auto" />
		</div>
	);
}
