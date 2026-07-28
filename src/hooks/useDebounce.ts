import { useRef, useCallback, useLayoutEffect } from "react";

export function useDebounce(fn: (...args: any[]) => void, delay: number): [(...args: any[]) => void, React.MutableRefObject<NodeJS.Timeout | null>] {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fnRef = useRef(fn);

  useLayoutEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  return [useCallback(
    (...args: any[]) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay]
  ), timeoutRef]
}
