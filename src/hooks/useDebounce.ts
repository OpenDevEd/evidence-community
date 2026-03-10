import { useRef, useCallback } from "react";

export function useDebounce(fn: (...args: any[]) => void, delay: number): [(...args: any[]) => void, React.MutableRefObject<NodeJS.Timeout | null>] {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return [useCallback(
    (...args: any[]) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay]
  ), timeoutRef]
}
