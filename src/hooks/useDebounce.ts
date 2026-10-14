import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Runs `fn` once the calls stop coming. The second value is the timer itself for older callers, the third cancels a
 * call that is still waiting, and the fourth runs it now: for a search the reader acts on before its wait is over.
 */
export function useDebounce(
	fn: (...args: any[]) => void,
	delay: number,
): [
	(...args: any[]) => void,
	React.MutableRefObject<NodeJS.Timeout | null>,
	() => void,
	() => void,
] {
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const waiting = useRef<any[] | null>(null);
	const fnRef = useRef(fn);

	useLayoutEffect(() => {
		fnRef.current = fn;
	}, [fn]);

	const run = useCallback(
		(...args: any[]) => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			waiting.current = args;
			timeoutRef.current = setTimeout(() => {
				timeoutRef.current = null;
				waiting.current = null;
				fnRef.current(...args);
			}, delay);
		},
		[delay],
	);

	// Reads its own timer, so callers never touch a ref themselves.
	const cancel = useCallback(() => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		timeoutRef.current = null;
		waiting.current = null;
	}, []);

	// The timer is the outside system: a call still waiting when the component goes away never runs, since it would act
	// on whatever page came next (a search typed just before a link was followed).
	useEffect(() => cancel, [cancel]);

	const flush = useCallback(() => {
		const args = waiting.current;
		cancel();
		if (args) fnRef.current(...args);
	}, [cancel]);

	return [run, timeoutRef, cancel, flush];
}

/** The value as it was once it stopped changing for `delay` ms: a search box's text, sent once typing pauses. */
export function useDebouncedValue<Value>(value: Value, delay: number) {
	const [debounced, setDebounced] = useState(value);
	// The timer is the outside system: it fires after the last change, and a newer change cancels it.
	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timeout);
	}, [delay, value]);
	return debounced;
}
