import { ModalContent } from "@nextui-org/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import DialogModal from "@/components/nextui/DialogModal";
import { ConfirmationModal } from "@/components/nextui/ConfirmationModal";
import {
	ListModalBody,
	type ListModalBodyItem,
} from "@/components/nextui/ListModalBody";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getAIModelPresentation } from "@/constants/ai";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import AIHeader from "./AIHeader";

interface ModelSelectorProps {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	selectedModelId: string | null;
	onModelChange: (modelId: string) => void;
	hasConversation?: boolean;
	onResetConversation?: () => void;
}

export default function ModelSelector({
	isOpen,
	onOpenChange,
	selectedModelId,
	onModelChange,
	hasConversation = false,
	onResetConversation,
}: ModelSelectorProps) {
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const { models } = useSelectedModel();
	const { ai } = useLibraryConfig();
	const [pendingModelId, setPendingModelId] = useState<string | null>(null);
	const selectedIndex = models.findIndex(
		(model) => model.id === selectedModelId,
	);
	const pendingModel = models.find((model) => model.id === pendingModelId);
	const close = () => {
		setPendingModelId(null);
		onOpenChange(false);
	};
	const changeModel = (modelId: string) => {
		onResetConversation?.();
		onModelChange(modelId);
		close();
	};

	return (
		<>
			<DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
				<ModalContent>
					<AIHeader onClose={close}>{t("change")}</AIHeader>
					<ListModalBody
						description={t("changeAbtract")}
						onAction={(index) => {
							const model = models[Number(index)];
							if (!model || model.id === selectedModelId) return;
							if (hasConversation) {
								onOpenChange(false);
								setPendingModelId(model.id);
								return;
							}
							changeModel(model.id);
						}}
						highlightedIndexes={
							selectedIndex >= 0 ? [selectedIndex] : []
						}
						list={models.map((model): ListModalBodyItem => {
							const presentation = getAIModelPresentation(
								model.id,
								ai.providers,
							);
							return {
								name: presentation.name,
								description: presentation.company,
								icon: presentation.icon,
							};
						})}
					/>
				</ModalContent>
			</DialogModal>
			<ConfirmationModal
				isOpen={pendingModel !== undefined}
				onOpenChange={(open) => {
					if (!open) setPendingModelId(null);
				}}
				title={
					pendingModel
						? t("changeModelWarningTitle", {
								model: pendingModel.name,
							})
						: ""
				}
				description={t("changeModelWarning")}
				confirmLabel={t("changeAndReset")}
				cancelLabel={tUI("cancel")}
				onConfirm={() => {
					if (pendingModel) changeModel(pendingModel.id);
				}}
			/>
		</>
	);
}
