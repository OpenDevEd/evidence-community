import { useCompletion } from "ai/react";
import { useLocale } from "next-intl";
import { useState, useCallback, useRef } from "react";

export default function useAIStream(endpoint: string) {
    const locale = useLocale();
    const { completion, complete, isLoading } = useCompletion({
        api: endpoint,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
        },
    })

    const debouncedComplete = useCallback((...args: Parameters<typeof complete>) => {
        if (isLoading || completion) return;
        complete(...args);
    }, [isLoading, completion, complete]);

	return { response: completion, stream: debouncedComplete };
}
