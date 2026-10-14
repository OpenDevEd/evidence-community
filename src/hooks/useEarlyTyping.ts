import { type RefObject, useLayoutEffect } from "react";

/**
 * A search field the server drew takes typing before the page is interactive. The browser keeps those words, but the
 * field's state never heard of them, and React's next render writes the state's value back over them. Once React holds
 * the field, this hands what the browser holds to `onTyped`, as if it had just been typed.
 */
export function useEarlyTyping(
	field: RefObject<HTMLElement | null>,
	value: string,
	onTyped: (text: string) => void,
) {
	// The browser's own field is the outside system: read once, when React takes the page over.
	useLayoutEffect(() => {
		const input = field.current?.querySelector("input");
		if (input && input.value !== value) onTyped(input.value);
	}, []);
}
