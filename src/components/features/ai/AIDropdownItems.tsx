import { useAIFeature } from "@/hooks/useAIFeature";
import React from "react";
import { getAIModelForUI } from "@/constants/ai";
import type { AIModelId } from "@/lib/ai/models";

export const AI_DROPDOWN_ITEMS = (
    t: any,
    selectedModel: AIModelId,
    onChangeOpenChange: () => void,
    summaryFeature: ReturnType<typeof useAIFeature>,
    explainFeature: ReturnType<typeof useAIFeature>,
    onChatOpenChange: () => void,
) => {
    const model = getAIModelForUI(selectedModel);
    return [
    {
        key: "change",
        label: t("change"),
        description: t("changeDescription", {
            model: model.name,
        }),
        startContent: (
            <div
                key={model.name}
                className="size-8 shrink-0 bg-accent p-1.5 rounded"
            >
                {React.createElement(model.icon, {
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
