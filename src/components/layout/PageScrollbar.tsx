"use client";

import { useEffect, useRef, type PointerEvent } from "react";

/**
 * The page's scrollbar, drawn over the page. The browser's own is hidden (`no-scrollbar` on `<html>`) because it takes
 * width from the page: everything, the navbar included, moved sideways between pages that scroll and pages such as the
 * map that do not. It shows while the page scrolls or under the pointer. The thumb can be dragged, and a click on the
 * track pages toward it, as the browser's own does.
 */
export default function PageScrollbar() {
	const track = useRef<HTMLDivElement>(null);
	const thumb = useRef<HTMLDivElement>(null);
	const drag = useRef<{ pointerY: number; scrollY: number } | null>(null);

	// Follows the window's scroll position and size and the page's height.
	useEffect(() => {
		const bar = track.current!;
		const handle = thumb.current!;
		const root = document.documentElement;
		let frame = 0;
		let fade = 0;
		const place = () => {
			frame = 0;
			const { scrollHeight, clientHeight } = root;
			const scrollable = scrollHeight - clientHeight;
			bar.hidden = scrollable <= 0;
			if (scrollable <= 0) return;
			const height = Math.max(40, (clientHeight * clientHeight) / scrollHeight);
			handle.style.height = `${height}px`;
			handle.style.transform = `translateY(${(window.scrollY / scrollable) * (clientHeight - height)}px)`;
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(place);
		};
		const scrolled = () => {
			schedule();
			bar.dataset.active = "";
			clearTimeout(fade);
			fade = window.setTimeout(() => delete bar.dataset.active, 900);
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

	function press(event: PointerEvent<HTMLDivElement>) {
		const handle = thumb.current!.getBoundingClientRect();
		if (event.clientY < handle.top || event.clientY > handle.bottom) {
			const page = document.documentElement.clientHeight * 0.9;
			window.scrollBy({ top: event.clientY < handle.top ? -page : page });
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { pointerY: event.clientY, scrollY: window.scrollY };
	}
	function move(event: PointerEvent<HTMLDivElement>) {
		if (!drag.current) return;
		const { scrollHeight, clientHeight } = document.documentElement;
		const room = clientHeight - thumb.current!.offsetHeight;
		window.scrollTo(0, drag.current.scrollY + ((event.clientY - drag.current.pointerY) * (scrollHeight - clientHeight)) / room);
	}

	// The inline end is where the browser puts the page's scrollbar, so right-to-left pages have it on the left.
	return (
		<div
			ref={track}
			aria-hidden
			hidden
			onPointerDown={press}
			onPointerMove={move}
			onPointerUp={() => (drag.current = null)}
			onPointerCancel={() => (drag.current = null)}
			className="group fixed inset-y-0 end-0 z-50 w-3 touch-none select-none px-0.5 opacity-0 transition-opacity duration-300 hover:opacity-100 active:opacity-100 data-[active]:opacity-100 motion-reduce:transition-none print:hidden [@media(any-hover:none)]:pointer-events-none"
		>
			<div ref={thumb} className="ms-1 rounded-full bg-[rgba(127,127,127,0.6)] transition-[margin] group-hover:ms-0 group-active:ms-0 forced-colors:bg-[CanvasText]" />
		</div>
	);
}
