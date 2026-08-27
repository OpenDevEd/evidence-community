import { models } from "@/constants/ai";
import { useTranslations } from "next-intl";
import { ModalContent } from "@nextui-org/react";
import AIHeader from "../ai/AIHeader";
import FullScreenModal from "../../nextui/FullScreenModal";
import {
	ListModalBody,
	ListModalBodyItem,
} from "@/components/nextui/ListModalBody";
import DialogModal from "@/components/nextui/DialogModal";
import type { AIModelId } from "@/lib/ai/models";
import { useState } from "react";
import { ConfirmationModal } from "@/components/nextui/ConfirmationModal";

interface ModelSelectorProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	selectedModel: AIModelId;
	onModelChange: (modelId: AIModelId) => void;
	hasConversation?: boolean;
}

export default function ModelSelector({
	isOpen,
	onOpenChange,
	selectedModel,
	onModelChange,
	hasConversation = false,
}: ModelSelectorProps) {
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");
	const [pendingModel, setPendingModel] = useState<AIModelId>();

	const selectModel = (modelId: AIModelId) => {
		if (hasConversation) {
			onOpenChange(false);
			setPendingModel(modelId);
			return;
		}
		onModelChange(modelId);
		onOpenChange(false);
	};

	return (
		<>
			<DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
				<ModalContent>
					<AIHeader onClose={() => onOpenChange(false)}>
						{t("change")}
					</AIHeader>
					<ListModalBody
						description={t("changeAbtract")}
						onAction={(index) => {
							const model = models[Number(index)];
							if (!model || model.id === selectedModel) return;
							selectModel(model.id);
						}}
						highlightedIndexes={[
							models.findIndex(
								(model) => model.id === selectedModel,
							),
						]}
						list={models.map((model): ListModalBodyItem => ({
							name: model.name,
							description: model.company,
							icon: model.icon,
						}))}
					/>
				</ModalContent>
			</DialogModal>
			<ConfirmationModal
				isOpen={pendingModel !== undefined}
				onOpenChange={(open) => {
					if (!open) setPendingModel(undefined);
				}}
				title={t("changeModelWarningTitle")}
				description={t("changeModelWarning")}
				confirmLabel={t("changeModelConfirm")}
				cancelLabel={tUI("cancel")}
				onConfirm={() => {
					if (!pendingModel) return;
					const modelId = pendingModel;
					setPendingModel(undefined);
					onModelChange(modelId);
				}}
			/>
		</>
	);
}
