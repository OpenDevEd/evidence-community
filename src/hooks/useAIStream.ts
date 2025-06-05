import { toast } from "@/components/layout/Toast";
import { getRateLimits } from "@/lib/actions";
import { useCompletion } from "ai/react";
import { useLocale, useTranslations } from "next-intl";
import posthog from "posthog-js";
import { useCallback } from "react";


export default function useAIStream(endpoint: string, onFinish: (completion: string, id: string) => void, id: string) {
    const locale = useLocale();
    const t = useTranslations("ai");
    const { completion, complete, isLoading, error, setCompletion } = useCompletion({
        api: endpoint,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
        },
        body: {
            distinctId: posthog.get_distinct_id()
        },
        onError: (e) => {
            (async () => {
                const rateLimits = await getRateLimits();
                if (e.message.includes("Rate limit exceeded")) {
                    toast({
                        title: t("rateLimitedMessage", { seconds: rateLimits.retryAfter ?? 0 }),
                        type: "error",
                    });
                }
            })();
        }
    })

    const debouncedComplete = useCallback((...args: Parameters<typeof complete>) => {
        if (isLoading || completion) return;
        onFinish(completion, id);
        complete(...args).then((completion) => {
            if (completion) {
                onFinish(completion, id);
            }
        });
    }, [isLoading, completion, complete, onFinish]);

	return { response: completion, stream: debouncedComplete, error, setCompletion };
}
