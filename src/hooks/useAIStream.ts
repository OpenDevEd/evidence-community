import { useCompletion } from "ai/react";
import { useLocale } from "next-intl";
import posthog from "posthog-js";
import { useCallback } from "react";

export default function useAIStream(endpoint: string, onFinish: (completion: string, id: string) => void, id: string) {
    const locale = useLocale();
    const { completion, complete, isLoading, error, setCompletion } = useCompletion({
        api: endpoint,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
        },
        body: {
            distinctId: posthog.get_distinct_id()
        },
    })

    const debouncedComplete = useCallback((...args: Parameters<typeof complete>) => {
        if (isLoading || completion) return;
        onFinish(completion, id);
        complete(...args).then((completion) => {
            if (completion) {
                console.log("Completion created", id);
                onFinish(completion, id);
            }
        });
    }, [isLoading, completion, complete, onFinish]);

	return { response: completion, stream: debouncedComplete, error, setCompletion };
}
