import { useRef, useCallback, useLayoutEffect } from "react";

/**
 * Runs `fn` once the calls stop coming. The second value cancels a call that
 * is still waiting, and the third is the timer itself for older callers.
 */
export function useDebounce(
	fn: (...args: any[]) => void,
	delay: number,
): [
	(...args: any[]) => void,
	React.MutableRefObject<NodeJS.Timeout | null>,
	() => void,
] {
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const fnRef = useRef(fn);

	useLayoutEffect(() => {
		fnRef.current = fn;
	}, [fn]);

	const run = useCallback(
		(...args: any[]) => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(
				() => fnRef.current(...args),
				delay,
			);
		},
		[delay],
	);

	// Reads its own timer, so callers never touch a ref themselves.
	const cancel = useCallback(() => {
		if (!timeoutRef.current) return;
		clearTimeout(timeoutRef.current);
		timeoutRef.current = null;
	}, []);

	return [run, timeoutRef, cancel];
}
