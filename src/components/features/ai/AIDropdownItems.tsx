import { models } from "@/constants/ai";
import { useAIFeature } from "@/hooks/useAIFeature";
import React from "react";

export const AI_DROPDOWN_ITEMS = (
    t: any,
    selectedModel: number,
    onChangeOpenChange: () => void,
    summaryFeature: ReturnType<typeof useAIFeature>,
    explainFeature: ReturnType<typeof useAIFeature>,
    onChatOpenChange: () => void,
) => [
    {
        key: "change",
        label: t("change"),
        description: t("changeDescription", {
            model: models[selectedModel].name,
        }),
        startContent: (
            <div
                key={models[selectedModel].name}
                className="size-8 shrink-0 bg-accent p-1.5 rounded"
            >
                {React.createElement(models[selectedModel].icon, {
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