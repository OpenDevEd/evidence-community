import { AI_PROVIDER_PRESENTATION } from "@/constants/ai";
import { useTranslations } from "next-intl";
import { ModalContent } from "@nextui-org/react";
import AIHeader from "../ai/AIHeader";
import FullScreenModal from "../../nextui/FullScreenModal";
import { ListModalBody, ListModalBodyItem } from "@/components/nextui/ListModalBody";
import DialogModal from "@/components/nextui/DialogModal";
import type { AIProviderId } from "@/lib/ai-provider-factory";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

interface ModelSelectorProps {
  isOpen: boolean;
  onOpenChange: () => void;
  selectedProvider: AIProviderId | null;
  onProviderChange: (provider: AIProviderId) => void;
}

export default function ModelSelector({
  isOpen,
  onOpenChange,
  selectedProvider,
  onProviderChange,
}: ModelSelectorProps) {
  const t = useTranslations("ai");
  const { ai } = useLibraryConfig();
  const providers = ai.providers.filter(
    (provider) => provider.enabled && provider.defaultModel,
  );
  const selectedIndex = providers.findIndex(
    (provider) => provider.provider === selectedProvider,
  );

  return (
    <DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        <AIHeader onClose={onOpenChange}>{t("change")}</AIHeader>
        <ListModalBody
          description={t("changeAbtract")}
          onAction={(index) => {
            const provider = providers[Number(index)]?.provider;
            if (!provider || provider === selectedProvider) return;
            onProviderChange(provider);
          }}
          highlightedIndexes={selectedIndex >= 0 ? [selectedIndex] : []}
          list={providers.map((provider): ListModalBodyItem => ({
            name: AI_PROVIDER_PRESENTATION[provider.provider].name,
            subtitle: AI_PROVIDER_PRESENTATION[provider.provider].company,
            description: provider.defaultModel ?? "",
            icon: AI_PROVIDER_PRESENTATION[provider.provider].icon,
          }))}
        />
      </ModalContent>
    </DialogModal>
  );
}
