"use client";
import { extendVariants, Select as NextUISelect } from "@nextui-org/react";

export const Select = extendVariants(NextUISelect, {
  variants: {
    variant: {
      base: {
        base: "max-w-52",
        trigger:
          "h-12 min-h-0 bg-secondary text-primary/60 border-small border-primary/10 px-6",
        value: "!text-primary/60 font-medium text-base text-center",
        popoverContent: "bg-secondary border-small border-primary/10",
      },
    },
  },
  defaultVariants: {
    variant: "base",
  },
});
