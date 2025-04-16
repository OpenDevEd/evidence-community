import { models } from "@/constants/ai";
import { useTranslations } from "next-intl";
import { ModalContent } from "@heroui/react";
import AIHeader from "../ai/AIHeader";
import FullScreenModal from "../../nextui/FullScreenModal";
import { ListModalBody, ListModalBodyItem } from "@/components/nextui/ListModalBody";
import DialogModal from "@/components/nextui/DialogModal";

interface ModelSelectorProps {
  isOpen: boolean;
  onOpenChange: () => void;
  selectedModel: number;
  onModelChange: (index: number) => void;
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
            const modelIndex = Number(index);
            if (modelIndex === selectedModel) return;
            onModelChange(modelIndex);
          }}
          highlightedIndexes={[selectedModel]}
          list={models.map((model): ListModalBodyItem => ({
            name: model.name,
            subtitle: model.company,
            description: model.model ?? "",
            icon: model.icon,
          }))}
        />
      </ModalContent>
    </DialogModal>
  );
} 