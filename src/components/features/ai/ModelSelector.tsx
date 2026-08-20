import { models } from "@/constants/ai";
import { useTranslations } from "next-intl";
import { ModalContent } from "@nextui-org/react";
import AIHeader from "../ai/AIHeader";
import FullScreenModal from "../../nextui/FullScreenModal";
import { ListModalBody, ListModalBodyItem } from "@/components/nextui/ListModalBody";
import DialogModal from "@/components/nextui/DialogModal";
import type { AIModelId } from "@/lib/ai/models";

interface ModelSelectorProps {
  isOpen: boolean;
  onOpenChange: () => void;
  selectedModel: AIModelId;
  onModelChange: (modelId: AIModelId) => void;
}

export default function ModelSelector({
  isOpen,
  onOpenChange,
  selectedModel,
  onModelChange,
}: ModelSelectorProps) {
  const t = useTranslations("ai");

  return (
    <DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        <AIHeader onClose={onOpenChange}>{t("change")}</AIHeader>
        <ListModalBody
          description={t("changeAbtract")}
          onAction={(index) => {
            const model = models[Number(index)];
            if (!model || model.id === selectedModel) return;
            onModelChange(model.id);
          }}
          highlightedIndexes={[
            models.findIndex((model) => model.id === selectedModel),
          ]}
          list={models.map((model): ListModalBodyItem => ({
            name: model.name,
            description: model.company,
            icon: model.icon,
          }))}
        />
      </ModalContent>
    </DialogModal>
  );
}
