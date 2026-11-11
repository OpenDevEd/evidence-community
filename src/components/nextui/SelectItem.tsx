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
        // A label wider than its list (large text, a narrow field) wraps and its row grows instead of being cut off,
        // as the menus' labels do.
        title: "font-medium text-base whitespace-normal break-words",
      },
    },
  },
  defaultVariants: {
    color: "secondary",
    variant: "default",
  },
});
