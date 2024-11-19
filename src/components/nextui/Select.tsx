"use client";
import { extendVariants, Select as NextUISelect } from "@nextui-org/react";

export const Select = extendVariants(NextUISelect, {
  variants: {
    color: {
      secondary: {
        trigger: "bg-secondary text-primary/60 border-primary/10",
        value: "!text-primary/60 font-medium text-base text-center",
        popoverContent: "bg-secondary border-primary/10",
      },
      tertiary: {
        trigger: "bg-tertiary/10 text-primary/60 border-primary/10 data-[hover]:bg-tertiary/20",
        value: "!text-primary/60 font-medium text-base text-center",
        popoverContent: "bg-tertiary-50 border-primary/10 ",
      }
    },
    variant: {
      default: {
        trigger:
          "border-small",
        value: "font-medium text-base text-center",
        popoverContent: "border-small ",
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
    custom: {
      default: {
        trigger: "h-12 min-h-0 px-6 rounded-2xl",
        selectorIcon: "!size-6",
        popoverContent: "rounded-2xl"
      },
    }
  },
  defaultVariants: {
    variant: "default",
    custom: "default",
    size: "sm",
    color: "secondary"
  },
});
