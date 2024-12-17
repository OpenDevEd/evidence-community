import { useCompletion } from "ai/react";
import { useLocale } from "next-intl";
import posthog from "posthog-js";
import { useCallback } from "react";

export default function useAIStream(endpoint: string) {
    const locale = useLocale();
    const { completion, complete, isLoading, error } = useCompletion({
        api: endpoint,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
        },
        body: {
            distinctId: posthog.get_distinct_id()
        }
    })

    const debouncedComplete = useCallback((...args: Parameters<typeof complete>) => {
        if (isLoading || completion) return;
        complete(...args);
    }, [isLoading, completion, complete]);

	return { response: completion, stream: debouncedComplete, error };
}
