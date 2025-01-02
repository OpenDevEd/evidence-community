"use client";
import { extendVariants, Select as NextUISelect } from "@nextui-org/react";

export const Select = extendVariants(NextUISelect, {
  variants: {
    color: {
      secondary: {
        trigger: "bg-white dark:bg-secondary text-black/80 dark:text-white/60 border-black/10 dark:border-white/10 data-[hover]:bg-black/[4%] dark:data-[hover]:bg-white/[4%]",
        value: "text-black/80 dark:text-white/60 font-medium text-base",
        popoverContent: "bg-white dark:bg-secondary border-black/10 dark:border-white/10 text-black/80 dark:text-white/60",
      },
      tertiary: {
        trigger: "bg-tertiary dark:bg-tertiary/10 text-white dark:text-white/60 border-white/10 data-[hover]:bg-tertiary-600 dark:data-[hover]:bg-tertiary/20",
        value: "text-white dark:text-white/60 font-medium text-base",
        popoverContent: "bg-tertiary dark:bg-tertiary-50 text-white dark:text-white/60 border-white/10 ",
      }
    },
    variant: {
      default: {
        trigger:
          "border-small",
        value: "font-medium text-base text-center rtl:text-center",
        popoverContent: "border-small ",
        label: "text-center w-full",
      },
    },
    size: {
      sm: { 
        base: "max-w-52",
      },
      md: {
        base: "max-w-72",
      }
    },
    placement: {
      center: {},
      left: {
        value: "text-left rtl:text-right",
        label: "text-left rtl:text-right",
      },
    },
    custom: {
      default: {
        trigger: "h-12 min-h-0 rounded-2xl",
        selectorIcon: "!size-6",
        popoverContent: "rounded-2xl"
      },
    }
  },
  defaultVariants: {
    variant: "default",
    custom: "default",
    size: "sm",
    color: "secondary",
    placement: "center",
  },
});
