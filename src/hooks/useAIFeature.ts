import { useDisclosure } from "@heroui/react";
import useAIStream from "./useAIStream";
import { ItemGetResponse } from "@/app/api/item/types";

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
    modelIndex: number
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
            body: { modelIndex },
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