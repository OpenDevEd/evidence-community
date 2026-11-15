import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Tick01Icon } from "@hugeicons/core-free-icons";
import { ModalBody, ModalBodyProps, Listbox, ListboxItem, Spinner } from "@nextui-org/react";
import { Key } from "react";

export type ListModalBodyItem = {
  name: string;
  subtitle?: string;
  description?: string;
  icon?: React.ElementType;
}

export function ListModalBody({ description, onAction, highlightedIndexes, children, list, isLoading, ...props }: { 
  description: string, 
  onAction: (index: number) => void, 
  highlightedIndexes?: number[], 
  list: ListModalBodyItem[],
  isLoading?: boolean
} & ModalBodyProps) {
  return (
    <ModalBody className="p-0 overflow-hidden" {...props}>
      <div className="flex flex-col pt-0 relative overflow-hidden">
        {isLoading && <div className="flex items-center justify-center absolute inset-0 ">
          <Spinner />
        </div>}
        <p className="text-base text-black/80 dark:text-white/80 font-medium p-4 text-center dark:bg-secondary bg-white">
          {description}
        </p>
        <Listbox
          aria-label={description}
          disabledKeys={isLoading ? list.map((_, index) => String(index)) : undefined}
          onAction={onAction as (key: Key) => void}
          classNames={{
            base: "p-0",
            list: "gap-0",
          }}
        >
          {list.map((item, index) => (
            <ListboxItem
              key={index}
              textValue={item.name}
              className="!p-0 !bg-transparent !rounded-none"
            >
              <div
                data-selected={highlightedIndexes?.includes(index)}
                className="p-6 cursor-pointer data-[selected=true]:dark:bg-accent/10 data-[selected=true]:bg-accent/20 transition-colors group rounded-none"
              >
                <div className="flex items-center gap-4 hover:brightness-75 active:scale-[95%] transition-all">
                  {item.icon && <div className="size-10 shrink-0 self-start bg-accent p-2 rounded">
                    <item.icon className="h-full w-full invert" />
                  </div>}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{item.name}</p>
                      {item.subtitle && <span className="text-xs text-default-500">
                        {item.subtitle}
                      </span>}
                    </div>
                    {item.description && <p className="text-sm text-default-500">{item.description}</p>}
                  </div>
                  <HugeiconsIcon icon={Tick01Icon} className="size-4 shrink-0 text-accent ltr:ml-auto rtl:mr-auto group-data-[selected=true]:opacity-100 group-data-[selected=true]:translate-x-0 transition-all opacity-0 ltr:-translate-x-10 rtl:translate-x-10" />
                </div>
              </div>
            </ListboxItem>
          ))}
        </Listbox>
      </div>
    </ModalBody>
  )
} 