"use client";
import {
  extendVariants,
  SelectItem as NextUISelectItem,
} from "@nextui-org/react";

export const SelectItem = extendVariants(NextUISelectItem, {
  variants: {
    color: {
      secondary: {
        title: "text-primary/60 font-medium text-base",
        base: "data-[selectable=true]:focus:bg-primary/10",
      },
    },
    variant: {
      default: {
        title: "font-medium text-base",
      },
    },
  },
  defaultVariants: {
    color: "secondary",
    variant: "default",
  },
});
