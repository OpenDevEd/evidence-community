"use client";

import type { KeyboardEvent, ReactNode, SyntheticEvent } from "react";

function stop(event: SyntheticEvent) {
	event.preventDefault();
	event.stopPropagation();
}

function stopActivation(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === " ") stop(event);
}

/**
 * A page to look at only: its links and buttons would lead the preview frame away, so presses stop here before they
 * reach them. Unlike `inert`, the content stays readable, screen readers included.
 */
export function LookOnly({ children }: { children: ReactNode }) {
	return (
		<div onClickCapture={stop} onPointerDownCapture={(event) => event.stopPropagation()} onKeyDownCapture={stopActivation}>
			{children}
		</div>
	);
}
