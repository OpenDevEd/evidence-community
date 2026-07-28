import { getAIProviderPresentation } from "@/constants/ai";
import { useAIFeature } from "@/hooks/useAIFeature";
import type { AIProviderId } from "@/lib/ai-provider-factory";
import React from "react";

export const AI_DROPDOWN_ITEMS = (
    t: any,
    selectedProvider: AIProviderId | null,
    onChangeOpenChange: () => void,
    summaryFeature: ReturnType<typeof useAIFeature>,
    explainFeature: ReturnType<typeof useAIFeature>,
    onChatOpenChange: () => void,
) => {
    const presentation = getAIProviderPresentation(selectedProvider);
    return [
        {
            key: "change",
            label: t("change"),
            description: t("changeDescription", {
                model: presentation.name,
            }),
            startContent: (
                <div
                    key={presentation.name}
                    className="size-8 shrink-0 bg-accent p-1.5 rounded"
                >
                    {React.createElement(presentation.icon, {
                        className: "h-full w-full invert",
                    })}
                </div>
            ),
            onPress: onChangeOpenChange,
        },
        {
            key: "summary",
            label: t("summarize"),
            description: t("summarizeDescription"),
            onPress: summaryFeature.onPress,
        },
        {
            key: "explain",
            label: t("explain"),
            description: t("explainDescription"),
            onPress: explainFeature.onPress,
        },
        {
            key: "chat",
            label: t("askAI"),
            description: t("chatDescription"),
            onPress: onChatOpenChange,
        },
    ];
};
