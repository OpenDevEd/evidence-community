import { toast } from "@/components/layout/Toast";
import { useCompletion } from "@ai-sdk/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import { analyticsIdField } from "@/lib/ai/chat-request";


export default function useAIStream(endpoint: string, onFinish: (completion: string, id: string) => void, id: string) {
    const locale = useLocale();
    const t = useTranslations("ai");
    const { completion, complete, isLoading, error, setCompletion } = useCompletion({
        api: endpoint,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
        },
        body: analyticsIdField(getAnalyticsDistinctId()),
        onError: (error) => {
            if (error.message.includes("RATE_LIMITED")) {
                const retryAfter = /Try again in (\d+) seconds/u.exec(error.message)?.[1] ?? "60";
                toast({
                    title: t("rateLimitedMessage", { seconds: Number(retryAfter) }),
                    type: "error",
                });
            }
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
    }, [isLoading, completion, complete, onFinish, id]);

	return { response: completion, stream: debouncedComplete, error, setCompletion };
}
