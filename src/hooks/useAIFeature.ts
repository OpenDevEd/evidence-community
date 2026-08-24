import { useDisclosure } from "@nextui-org/react";
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
    modelId: string | null,
): AIFeature {
    const { isOpen, onOpenChange } = useDisclosure();
    const {
        response,
        stream,
        error,
        setCompletion,
    } = useAIStream(
        "/api/ai",
        (completion, id) => updateHistory(key, completion, id),
        id,
    );

    const onPress = () => {
        onOpenChange();
        stream(item?.item?.key ?? "", {
            body: { feature: key, modelId },
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
