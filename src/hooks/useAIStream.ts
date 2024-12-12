import { useCompletion } from "ai/react";
import { useLocale } from "next-intl";
import { useState, useCallback, useRef } from "react";

export default function useAIStream(endpoint: string) {
    const locale = useLocale();
    const { completion, complete } = useCompletion({
        api: endpoint,
        headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
        },
    })

	return { response: completion, stream: complete };
}
