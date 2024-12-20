import { models } from "@/constants/ai";
import { useTranslations } from "next-intl";
import { ModalContent, ModalBody, Listbox, ListboxItem } from "@nextui-org/react";
import { FaCheck } from "react-icons/fa";
import AIHeader from "../ai/AIHeader";
import AIModal from "../../nextui/AIModal";

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
    <AIModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        <AIHeader onClose={onOpenChange}>{t("change")}</AIHeader>
        <ModalBody className="p-0">
          <div className="flex flex-col pt-0">
            <p className="text-base text-black/80 dark:text-white/80 font-medium p-2 text-center dark:bg-secondary bg-white">
              {t("changeAbtract")}
            </p>
            <Listbox
              onAction={(index) => {
                const modelIndex = Number(index);
                if (modelIndex === selectedModel) return;
                onModelChange(modelIndex);
              }}
              classNames={{
                base: "p-0",
                list: "gap-0",
              }}
            >
              {models.map((model, index) => (
                <ListboxItem
                  key={index}
                  className="!p-0 !bg-transparent !rounded-none"
                >
                  <div
                    data-selected={index === selectedModel}
                    className="p-6 cursor-pointer data-[selected=true]:dark:bg-accent/10 data-[selected=true]:bg-accent/20 transition-colors group rounded-none"
                  >
                    <div className="flex items-center gap-4 hover:brightness-75 active:scale-[95%] transition-all">
                      <div className="size-10 shrink-0 bg-accent p-2 rounded">
                        <model.icon className="h-full w-full invert" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{model.name}</p>
                          <span className="text-xs text-default-500">
                            {t("byCompany", { company: model.company })}
                          </span>
                        </div>
                        <p className="text-sm text-default-500">{model.model}</p>
                      </div>
                      <FaCheck className="size-4 shrink-0 text-accent ltr:ml-auto rtl:mr-auto group-data-[selected=true]:opacity-100 group-data-[selected=true]:translate-x-0 transition-all opacity-0 ltr:-translate-x-10 rtl:translate-x-10" />
                    </div>
                  </div>
                </ListboxItem>
              ))}
            </Listbox>
          </div>
        </ModalBody>
      </ModalContent>
    </AIModal>
  );
} 