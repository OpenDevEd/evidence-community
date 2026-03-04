"use client";

import { useEffect, useState } from "react";

type MousePosition = {
	x: number;
	y: number;
};

const INITIAL_MOUSE_POSITION: MousePosition = {
	x: 0,
	y: 0,
};

export function useMousePosition(): MousePosition {
	const [mousePosition, setMousePosition] = useState<MousePosition>(
		INITIAL_MOUSE_POSITION
	);

	useEffect(() => {
		const handleMouseMove = (event: MouseEvent) => {
			setMousePosition({
				x: event.pageX,
				y: event.pageY,
			});
		};

		window.addEventListener("mousemove", handleMouseMove, {
			passive: true,
		});

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
		};
	}, []);

	return mousePosition;
}
