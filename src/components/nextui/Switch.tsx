"use client";
import { extendVariants, Switch as NextUISwitch } from "@nextui-org/react";

export const Switch = extendVariants(NextUISwitch, {
  variants: {
    color: {
      tertiary: {
        wrapper: "group-data-[selected]:bg-tertiary ring-white/60",
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
