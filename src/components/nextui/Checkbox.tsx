"use client";
import { extendVariants, Checkbox as NextUICheckbox } from "@nextui-org/react";

export const Checkbox = extendVariants(NextUICheckbox, {
  variants: {
    size: {
      xl: {
        label: "text-xl",
        wrapper: [
          "w-7 h-7 mr-3 rtl:ml-2 rtl:mr-[unset]",
          "rounded-[calc(theme(borderRadius.medium)*0.6)]",
          "before:rounded-[calc(theme(borderRadius.medium)*0.6)]",
          "after:rounded-[calc(theme(borderRadius.medium)*0.6)]",
          "before:border-[3px]",
          "after:bg-accent",
        ],
        icon: "w-5 h-4 ",
      },
      lg: {
        base: "ml-8",
        label: "text-xl",
        wrapper: [
          "w-6 h-6 mr-3 rtl:ml-2 rtl:mr-[unset]",
          "rounded-[calc(theme(borderRadius.medium)*0.6)]",
          "before:rounded-[calc(theme(borderRadius.medium)*0.6)]",
          "after:rounded-[calc(theme(borderRadius.medium)*0.6)]",
          "before:border-[3px]",
          "after:bg-accent",
        ],
        icon: "w-4 h-3",
      }
    },
    color: {
      primary: {
        label: "text-primary/40 font-normal",
      },
    },
  },
  defaultVariants: {
    color: "primary",
    size: "xl",
  },
});
