import { ModalContent } from "@nextui-org/react";
import { useTranslations } from "next-intl";

import DialogModal from "@/components/nextui/DialogModal";
import {
	ListModalBody,
	type ListModalBodyItem,
} from "@/components/nextui/ListModalBody";
import { getAIModelPresentation } from "@/constants/ai";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import AIHeader from "./AIHeader";

interface ModelSelectorProps {
	isOpen: boolean;
	onOpenChange: () => void;
	selectedModelId: string | null;
	onModelChange: (modelId: string) => void;
}

export default function ModelSelector({
	isOpen,
	onOpenChange,
	selectedModelId,
	onModelChange,
}: ModelSelectorProps) {
	const t = useTranslations("ai");
	const { models } = useSelectedModel();
	const selectedIndex = models.findIndex(
		(model) => model.id === selectedModelId,
	);

	return (
		<DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent>
				<AIHeader onClose={onOpenChange}>{t("change")}</AIHeader>
				<ListModalBody
					description={t("changeAbtract")}
					onAction={(index) => {
						const model = models[Number(index)];
						if (!model || model.id === selectedModelId) return;
						onModelChange(model.id);
					}}
					highlightedIndexes={selectedIndex >= 0 ? [selectedIndex] : []}
					list={models.map((model): ListModalBodyItem => {
						const presentation = getAIModelPresentation(model.id);
						return {
							name: presentation.name,
							subtitle: presentation.company,
							description: model.id,
							icon: presentation.icon,
						};
					})}
				/>
			</ModalContent>
		</DialogModal>
	);
}
