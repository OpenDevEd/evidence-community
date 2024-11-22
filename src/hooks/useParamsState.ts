import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export function useParamsState() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    const createQueryString = useCallback(
        (pathname: string, newParams: [string, string][]) => {
          const params = new URLSearchParams(searchParams.toString());
          newParams.forEach(([name, value]) => {
            if (value) {
              params.set(name, value);
            } else {
              params.delete(name);
            }
          });
          return `${pathname}?${params.toString()}`;
        },
        [searchParams]
      );

    return { createQueryString, router, searchParams, pathname };
}
