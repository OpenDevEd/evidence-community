"use client";
import { extendVariants, Switch as NextUISwitch } from "@nextui-org/react";
import { useId, type ComponentProps } from "react";

const VariantSwitch = extendVariants(NextUISwitch, {
  variants: {
    color: {
      tertiary: {
        wrapper: "group-data-[selected]:bg-tertiary ring-white/60",
      },
      accent: {
        wrapper: "group-data-[selected]:bg-accent ring-white/60",
      },
    },
    custom: {
      default: {
        base: "flex-row-reverse gap-2",
        wrapper: "mr-0 rtl:ml-0",
      },
    },
    variant: {
      default: {
        wrapper: "ring-[0.5px]"
      },
    },
    size: {
      sm: {
        label: "text-base font-medium text-black/80 dark:text-white/60 ms-0",
        wrapper: "h-4 w-8 p-0.5",
        base: "h-4 p-0",
        thumb: "h-3 w-3 group-data-[selected]:ml-4",
      },
    },
  },
  defaultVariants: {
    custom: "default",
    color: "tertiary",
    size: "sm",
    variant: "default",
  },
});

/**
 * On Back and Forward, WebKit puts each unnamed checkbox back as it was by its place among the page's unnamed checkboxes,
 * so one drawn only in the browser (a collection's) hands its state to a switch, and React takes that as the reader turning
 * the switch. A name of its own keeps each switch's state its own.
 */
export function Switch(props: ComponentProps<typeof VariantSwitch>) {
  return <VariantSwitch name={useId()} {...props} />;
}
