"use client";
import {
  extendVariants,
  SelectItem as HeroUISelectItem,
} from "@heroui/react";

export const SelectItem = extendVariants(HeroUISelectItem, {
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
