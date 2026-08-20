import { useDisclosure } from "@nextui-org/react";
import useAIStream from "./useAIStream";
import { ItemGetResponse } from "@/app/api/item/types";
import type { AIModelId } from "@/lib/ai/models";

type AIFeature = {
	key: "summarize" | "explain";
	isOpen: boolean;
	onOpenChange: () => void;
	response: string;
	isLoading: boolean;
	hasRequested: boolean;
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
	modelId: AIModelId,
): AIFeature {
	const { isOpen, onOpenChange } = useDisclosure();
	const { response, stream, isLoading, hasRequested, error, setCompletion } =
		useAIStream(
			"/api/ai",
			(completion, id) => updateHistory(key, completion, id),
			id,
			key,
		);

	const onPress = () => {
		onOpenChange();
		stream(item?.item?.key ?? "", {
			body: { modelId },
		});
	};

	return {
		key,
		isOpen,
		onOpenChange,
		response,
		isLoading,
		hasRequested,
		error,
		stream,
		setCompletion,
		onPress,
	};
}
