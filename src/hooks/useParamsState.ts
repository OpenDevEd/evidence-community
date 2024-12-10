import { useCallback } from "react";
import { useRouter } from "@/i18n/routing";
import { usePathname } from "@/i18n/routing";

export function useParamsState(searchParams: { [key: string]: any }) {
    const router = useRouter();
    const pathname = usePathname();

    const createQueryString = useCallback(
        (pathname: string, newParams: [string, string][]) => {
          const params = new URLSearchParams(searchParams);

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

    return { createQueryString, router, pathname };
}
