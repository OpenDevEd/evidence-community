"use client";
import {
  extendVariants,
  SelectItem as NextUISelectItem,
} from "@nextui-org/react";

export const SelectItem = extendVariants(NextUISelectItem, {
  variants: {
    color: {
      secondary: {
        title: "text-current font-medium text-base",
        base: "data-[selectable=true]:focus:bg-black/[4%] dark:data-[selectable=true]:focus:bg-white/[4%]",
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
