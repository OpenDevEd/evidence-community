import { useDisclosure } from "@nextui-org/react";
import useAIStream from "./useAIStream";
import { ItemGetResponse } from "@/app/api/item/types";
import type { AIProviderId } from "@/lib/ai-provider-factory";

type AIFeature = {
    key: "summarize" | "explain";
    isOpen: boolean;
    onOpenChange: () => void;
    response: string;
    error: Error | undefined;
    stream: (key: string, options: any) => void;
    setCompletion: (completion: string) => void;
    onPress: () => void;
};

export function useAIFeature(
    key: "summarize" | "explain",
    id: string,
    updateHistory: (prompt: string, completion: string, id: string) => void,
    item: ItemGetResponse | undefined,
    provider: AIProviderId | null,
): AIFeature {
    const { isOpen, onOpenChange } = useDisclosure();
    const {
        response,
        stream,
        error,
        setCompletion,
    } = useAIStream(
        `/api/ai?prompt=${key}`,
        (completion, id) => updateHistory(key, completion, id),
        id,
    );

    const onPress = () => {
        onOpenChange();
        stream(item?.item?.key ?? "", {
            body: { provider },
        });
    };

    return {
        key,
        isOpen,
        onOpenChange,
        response,
        error,
        stream,
        setCompletion,
        onPress,
    };
}
